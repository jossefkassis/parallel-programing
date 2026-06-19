import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../db/database.service';
import { orderItems, orders, products, wallets } from '../db/schema';
import { QueuesService } from '../queues/queues.service';
import { ExperimentLoggerService } from '../logging/experiment-logger.service';
import { RedisService } from '../redis/redis.service';

type CheckoutItem = { productId: number; quantity: number };
type NormalizedCheckoutItem = CheckoutItem & { price?: string };

@Injectable()
export class OrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly queues: QueuesService,
    private readonly logger: ExperimentLoggerService,
    private readonly redis: RedisService,
  ) {}

  async createPending(userId: number, items: CheckoutItem[]) {
    const productRows = await this.database.db.select().from(products).where(inArray(products.id, items.map((i) => i.productId)));
    if (productRows.length !== items.length) throw new BadRequestException('Invalid product');
    const total = items.reduce((sum, item) => {
      const product = productRows.find((p) => p.id === item.productId)!;
      return sum + Number(product.price) * item.quantity;
    }, 0);
    const [wallet] = await this.database.db.select().from(wallets).where(eq(wallets.userId, userId));
    if (!wallet || Number(wallet.balance) < total) throw new BadRequestException('Insufficient wallet balance');

    const ref = randomUUID();
    return this.database.transaction(async (client) => {
      const insertedOrder = await client.query(
        'INSERT INTO orders (user_id, total, fake_payment_ref) VALUES ($1, $2, $3) RETURNING *',
        [userId, total.toFixed(2), ref],
      );
      const order = insertedOrder.rows[0];
      for (const item of items) {
        const product = productRows.find((p) => p.id === item.productId)!;
        await client.query('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)', [
          order.id,
          item.productId,
          item.quantity,
          product.price,
        ]);
      }
      return { order, fakePaymentRef: ref };
    });
  }

  async get(id: number) {
    const [order] = await this.database.db.select().from(orders).where(eq(orders.id, id));
    if (!order) throw new NotFoundException('Order not found');
    const items = await this.database.db.select().from(orderItems).where(eq(orderItems.orderId, id));
    return { ...order, items };
  }

  async confirmPayment(fakePaymentRef: string, success: boolean) {
    if (!success) {
      const [updated] = await this.database.db
        .update(orders)
        .set({ status: 'payment_failed', paymentStatus: 'failed', updatedAt: new Date() })
        .where(eq(orders.fakePaymentRef, fakePaymentRef))
        .returning();
      await this.logger.write('orders', 'payment_failed', { fakePaymentRef, reason: 'provider reported failed payment', orderId: updated?.id });
      return updated;
    }

    const order = await this.database.transaction(async (client) => {
      const orderResult = await client.query('SELECT id, user_id, total FROM orders WHERE fake_payment_ref = $1 FOR UPDATE', [fakePaymentRef]);
      const lockedOrder = orderResult.rows[0];
      if (!lockedOrder) throw new NotFoundException('Order not found');

      const walletResult = await client.query('SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE', [lockedOrder.user_id]);
      const wallet = walletResult.rows[0];
      if (!wallet || Number(wallet.balance) < Number(lockedOrder.total)) throw new BadRequestException('Insufficient wallet balance');

      const itemsResult = await client.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id', [lockedOrder.id]);
      for (const item of itemsResult.rows) {
        const productResult = await client.query('SELECT id, stock FROM products WHERE id = $1 FOR UPDATE', [item.product_id]);
        const product = productResult.rows[0];
        if (!product || product.stock < item.quantity) throw new BadRequestException('Insufficient stock');
      }

      await client.query('UPDATE wallets SET balance = balance - $1, updated_at = now() WHERE id = $2', [lockedOrder.total, wallet.id]);
      for (const item of itemsResult.rows) {
        await client.query('UPDATE products SET stock = stock - $1, version = version + 1, updated_at = now() WHERE id = $2', [
          item.quantity,
          item.product_id,
        ]);
      }
      const updated = await client.query(
        "UPDATE orders SET status = 'confirmed', payment_status = 'succeeded', updated_at = now() WHERE id = $1 RETURNING *",
        [lockedOrder.id],
      );
      return { order: updated.rows[0], productIds: itemsResult.rows.map((item) => Number(item.product_id)) };
    });
    await this.invalidateProductCaches(order.productIds);
    await this.queues.enqueueAfterPayment(order.order.id);
    await this.logger.write('orders', 'payment_confirmed', { fakePaymentRef, orderId: order.order.id, status: order.order.status });
    return order.order;
  }

  async acidDirectCheckout(userId: number, items: CheckoutItem[], failPayment: boolean) {
    const normalizedItems = this.normalizeItems(items);
    return this.database.transaction(async (client) => {
      const walletResult = await client.query('SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
      const wallet = walletResult.rows[0];
      if (!wallet) throw new NotFoundException('Wallet not found');

      const productIds = normalizedItems.map((item) => item.productId);
      const productResult = await client.query('SELECT id, name, price, stock FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [
        productIds,
      ]);
      if (productResult.rowCount !== normalizedItems.length) throw new BadRequestException('Invalid product');

      const productsById = new Map(productResult.rows.map((product) => [Number(product.id), product]));
      const total = normalizedItems.reduce((sum, item) => {
        const product = productsById.get(item.productId);
        if (!product || product.stock < item.quantity) throw new BadRequestException('Insufficient stock');
        item.price = product.price;
        return sum + Number(product.price) * item.quantity;
      }, 0);
      if (Number(wallet.balance) < total) throw new BadRequestException('Insufficient wallet balance');

      const insertedOrder = await client.query(
        'INSERT INTO orders (user_id, total, fake_payment_ref) VALUES ($1, $2, $3) RETURNING *',
        [userId, total.toFixed(2), randomUUID()],
      );
      const order = insertedOrder.rows[0];

      for (const item of normalizedItems) {
        await client.query('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)', [
          order.id,
          item.productId,
          item.quantity,
          item.price,
        ]);
      }

      await client.query('UPDATE wallets SET balance = balance - $1, updated_at = now() WHERE id = $2', [total.toFixed(2), wallet.id]);
      for (const item of normalizedItems) {
        await client.query('UPDATE products SET stock = stock - $1, version = version + 1, updated_at = now() WHERE id = $2', [
          item.quantity,
          item.productId,
        ]);
      }

      if (failPayment) {
        throw new Error('Forced payment failure after wallet, stock, order, and item changes');
      }

      const confirmed = await client.query(
        "UPDATE orders SET status = 'confirmed', payment_status = 'succeeded', updated_at = now() WHERE id = $1 RETURNING *",
        [order.id],
      );
      return { order: confirmed.rows[0], total: total.toFixed(2), lockedProductIds: productIds };
    }).then(async (result) => {
      await this.invalidateProductCaches(result.lockedProductIds);
      await this.queues.enqueueAfterPayment(result.order.id);
      await this.logger.write('orders', 'acid_direct_checkout_confirmed', {
        userId,
        orderId: result.order.id,
        total: result.total,
        lockedProductIds: result.lockedProductIds,
      });
      return result;
    });
  }

  async unsafeBuy(productId: number, quantity: number) {
    const [product] = await this.database.db.select().from(products).where(eq(products.id, productId));
    if (!product || product.stock < quantity) throw new BadRequestException('Insufficient stock');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const [updated] = await this.database.db
      .update(products)
      .set({ stock: product.stock - quantity, version: sql`${products.version} + 1`, updatedAt: new Date() })
      .where(eq(products.id, productId))
      .returning();
    await this.invalidateProductCaches([productId]);
    return updated;
  }

  async safeBuy(productId: number, quantity: number) {
    const updated = await this.database.transaction(async (client) => {
      const productResult = await client.query('SELECT id, stock FROM products WHERE id = $1 FOR UPDATE', [productId]);
      const product = productResult.rows[0];
      if (!product || product.stock < quantity) throw new BadRequestException('Insufficient stock');
      const updated = await client.query('UPDATE products SET stock = stock - $1, version = version + 1, updated_at = now() WHERE id = $2 RETURNING *', [
        quantity,
        productId,
      ]);
      return updated.rows[0];
    });
    await this.invalidateProductCaches([productId]);
    return updated;
  }

  async redisLockedBuy(productId: number, quantity: number) {
    const updated = await this.redis.withLock(`locks:inventory:${productId}`, 5000, async () => {
      const [product] = await this.database.db.select().from(products).where(eq(products.id, productId));
      if (!product || product.stock < quantity) throw new BadRequestException('Insufficient stock');
      await new Promise((resolve) => setTimeout(resolve, 30));
      const [updated] = await this.database.db
        .update(products)
        .set({ stock: product.stock - quantity, version: sql`${products.version} + 1`, updatedAt: new Date() })
        .where(eq(products.id, productId))
        .returning();
      return updated;
    });
    await this.invalidateProductCaches([productId]);
    return updated;
  }

  async optimisticBuy(productId: number, quantity: number, maxRetries = 8) {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const [product] = await this.database.db.select().from(products).where(eq(products.id, productId));
      if (!product || product.stock < quantity) throw new BadRequestException('Insufficient stock');
      await new Promise((resolve) => setTimeout(resolve, 30));

      const [updated] = await this.database.db
        .update(products)
        .set({ stock: sql`${products.stock} - ${quantity}`, version: sql`${products.version} + 1`, updatedAt: new Date() })
        .where(and(eq(products.id, productId), eq(products.version, product.version), gte(products.stock, quantity)))
        .returning();

      if (updated) {
        await this.invalidateProductCaches([productId]);
        return { ...updated, attempts: attempt };
      }
    }

    throw new Error(`Optimistic lock conflict after ${maxRetries} attempts`);
  }

  async countByStatus() {
    const rows = await this.database.pool.query('SELECT status, payment_status, count(*)::int AS count FROM orders GROUP BY status, payment_status');
    return rows.rows;
  }

  private normalizeItems(items: CheckoutItem[]): NormalizedCheckoutItem[] {
    const byProduct = new Map<number, number>();
    for (const item of items) {
      byProduct.set(item.productId, (byProduct.get(item.productId) ?? 0) + item.quantity);
    }
    return [...byProduct.entries()]
      .map(([productId, quantity]) => ({ productId, quantity }))
      .sort((left, right) => left.productId - right.productId);
  }

  private async invalidateProductCaches(productIds: number[]) {
    const keys = ['products:popular:v1', ...[...new Set(productIds)].map((id) => `product:${id}`)];
    await this.redis.del(...keys);
  }
}
