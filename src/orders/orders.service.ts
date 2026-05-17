import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../db/database.service';
import { orderItems, orders, products, wallets } from '../db/schema';
import { QueuesService } from '../queues/queues.service';

type CheckoutItem = { productId: number; quantity: number };

@Injectable()
export class OrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly queues: QueuesService,
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
      return updated;
    }

    const order = await this.database.transaction(async (client) => {
      const orderResult = await client.query('SELECT id, user_id, total FROM orders WHERE fake_payment_ref = $1 FOR UPDATE', [fakePaymentRef]);
      const lockedOrder = orderResult.rows[0];
      if (!lockedOrder) throw new NotFoundException('Order not found');

      const walletResult = await client.query('SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE', [lockedOrder.user_id]);
      const wallet = walletResult.rows[0];
      if (!wallet || Number(wallet.balance) < Number(lockedOrder.total)) throw new BadRequestException('Insufficient wallet balance');

      const itemsResult = await client.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [lockedOrder.id]);
      for (const item of itemsResult.rows) {
        const productResult = await client.query('SELECT id, stock FROM products WHERE id = $1 FOR UPDATE', [item.product_id]);
        const product = productResult.rows[0];
        if (!product || product.stock < item.quantity) throw new BadRequestException('Insufficient stock');
      }

      await client.query('UPDATE wallets SET balance = balance - $1, updated_at = now() WHERE id = $2', [lockedOrder.total, wallet.id]);
      for (const item of itemsResult.rows) {
        await client.query('UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2', [item.quantity, item.product_id]);
      }
      const updated = await client.query(
        "UPDATE orders SET status = 'confirmed', payment_status = 'succeeded', updated_at = now() WHERE id = $1 RETURNING *",
        [lockedOrder.id],
      );
      return updated.rows[0];
    });
    await this.queues.enqueueAfterPayment(order.id);
    return order;
  }

  async unsafeBuy(productId: number, quantity: number) {
    const [product] = await this.database.db.select().from(products).where(eq(products.id, productId));
    if (!product || product.stock < quantity) throw new BadRequestException('Insufficient stock');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const [updated] = await this.database.db
      .update(products)
      .set({ stock: product.stock - quantity, updatedAt: new Date() })
      .where(eq(products.id, productId))
      .returning();
    return updated;
  }

  async safeBuy(productId: number, quantity: number) {
    return this.database.transaction(async (client) => {
      const productResult = await client.query('SELECT id, stock FROM products WHERE id = $1 FOR UPDATE', [productId]);
      const product = productResult.rows[0];
      if (!product || product.stock < quantity) throw new BadRequestException('Insufficient stock');
      const updated = await client.query('UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2 RETURNING *', [
        quantity,
        productId,
      ]);
      return updated.rows[0];
    });
  }

  async countByStatus() {
    const rows = await this.database.pool.query('SELECT status, payment_status, count(*)::int AS count FROM orders GROUP BY status, payment_status');
    return rows.rows;
  }
}
