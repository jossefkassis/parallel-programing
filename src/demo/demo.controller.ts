import { Body, Controller, Get, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DatabaseService } from '../db/database.service';
import { orderItems, orders, products, users, wallets } from '../db/schema';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { QueuesService } from '../queues/queues.service';
import { RedisService } from '../redis/redis.service';
import { ZodPipe } from '../validation/zod.pipe';
import { ExperimentLoggerService } from '../logging/experiment-logger.service';

const raceSchema = z.object({ productId: z.coerce.number().int().positive().default(1), requests: z.coerce.number().int().positive().default(25) });
const checkoutSchema = z.object({ userId: z.coerce.number().int().positive().default(1), productId: z.coerce.number().int().positive().default(1), quantity: z.coerce.number().int().positive().default(1) });
const acidSchema = z.object({ fail: z.coerce.boolean().default(false) });
const acidDirectSchema = z.object({
  userId: z.coerce.number().int().positive().default(1),
  items: z
    .array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().positive() }))
    .min(1)
    .default([{ productId: 1, quantity: 1 }]),
  failPayment: z.coerce.boolean().default(false),
});

@Controller()
export class DemoController {
  constructor(
    private readonly database: DatabaseService,
    private readonly ordersService: OrdersService,
    private readonly payments: PaymentsService,
    private readonly queues: QueuesService,
    private readonly redis: RedisService,
    private readonly logger: ExperimentLoggerService,
  ) {}

  @Get('health')
  health() {
    return { ok: true, instance: process.env.INSTANCE_NAME ?? 'app-local', port: process.env.PORT ?? 3000, time: new Date().toISOString() };
  }

  @Post('demo/reset')
  async reset() {
    await this.database.pool.query(
      'TRUNCATE TABLE order_items, orders, wallets, users, products, job_logs, daily_sales_summaries RESTART IDENTITY CASCADE',
    );
    const [user] = await this.database.db.insert(users).values({ name: 'Demo User', email: `demo-${Date.now()}@example.com` }).returning();
    await this.database.db.insert(wallets).values({ userId: user.id, balance: '100000.00' });
    const insertedProducts = await this.database.db.insert(products).values([
      { name: 'Keyboard', price: '120.00', stock: 100 },
      { name: 'Mouse', price: '80.00', stock: 100 },
      { name: 'Monitor', price: '900.00', stock: 40 },
    ]).returning();
    await this.redis.del('products:popular:v1', 'product:1', 'product:2', 'product:3');
    return { user, products: insertedProducts };
  }

  @Post('demo/race/unsafe')
  async raceUnsafe(@Body(new ZodPipe(raceSchema)) body: z.infer<typeof raceSchema>) {
    return this.runRace(body.productId, body.requests, false);
  }

  @Post('demo/race/safe')
  async raceSafe(@Body(new ZodPipe(raceSchema)) body: z.infer<typeof raceSchema>) {
    return this.runRace(body.productId, body.requests, true);
  }

  @Post('demo/compare/race')
  async compareRace() {
    const unsafe = await this.runRace(1, 25, false);
    const safe = await this.runRace(1, 25, true);
    return {
      topic: 'Concurrent access and data integrity',
      withoutCorrectStructure: unsafe,
      withCorrectStructure: safe,
      conclusion: {
        databaseEffect: `unsafe final stock=${unsafe.finalStock}, safe final stock=${safe.finalStock}`,
        result: safe.finalStock === 0 && unsafe.finalStock !== safe.finalStock ? 'PASS: row locking prevents lost updates' : 'CHECK RESULTS',
      },
    };
  }

  @Post('demo/lock/redis')
  async redisLock(@Body(new ZodPipe(raceSchema)) body: z.infer<typeof raceSchema>) {
    return this.runRedisLock(body.productId, body.requests);
  }

  @Post('demo/lock/optimistic')
  async optimisticLock(@Body(new ZodPipe(raceSchema)) body: z.infer<typeof raceSchema>) {
    return this.runOptimisticLock(body.productId, body.requests);
  }

  @Post('demo/compare/locking')
  async compareLocking() {
    const unsafe = await this.runRace(1, 25, false);
    const redisLock = await this.runRedisLock(1, 25);
    return {
      topic: 'Concurrency control with a shared Redis lock',
      withoutCorrectStructure: unsafe,
      withCorrectStructure: redisLock,
      conclusion: {
        databaseEffect: `unsafe final stock=${unsafe.finalStock}, redis-lock final stock=${redisLock.finalStock}`,
        result: redisLock.finalStock === 0 && unsafe.finalStock !== redisLock.finalStock ? 'PASS: Redis distributed lock prevents concurrent inventory updates across app instances' : 'CHECK RESULTS',
      },
    };
  }

  @Post('demo/resource/uncontrolled')
  async resourceUncontrolled() {
    return this.resourceWork(80, 80, false);
  }

  @Post('demo/resource/controlled')
  async resourceControlled() {
    return this.resourceWork(80, Number(process.env.SERVICE_CONCURRENCY ?? 8), true);
  }

  @Post('demo/compare/resource')
  async compareResource() {
    const uncontrolled = await this.resourceWork(80, 80, false);
    const controlled = await this.resourceWork(80, Number(process.env.SERVICE_CONCURRENCY ?? 8), true);
    return {
      topic: 'Resource management and capacity control',
      withoutCorrectStructure: uncontrolled,
      withCorrectStructure: controlled,
      conclusion: {
        peakWorkReducedBy: uncontrolled.peakActive - controlled.peakActive,
        result: controlled.peakActive < uncontrolled.peakActive ? 'PASS: concurrency cap controls resource pressure' : 'CHECK RESULTS',
      },
    };
  }

  @Post('demo/checkout/sync')
  async checkoutSync(@Body(new ZodPipe(checkoutSchema)) body: z.infer<typeof checkoutSchema>) {
    const start = performance.now();
    const pending = await this.ordersService.createPending(body.userId, [{ productId: body.productId, quantity: body.quantity }]);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const order = await this.ordersService.confirmPayment(pending.fakePaymentRef, true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const result = { mode: 'sync', durationMs: Math.round(performance.now() - start), order };
    await this.logger.write('checkout', 'sync_completed', {
      userId: body.userId,
      productId: body.productId,
      quantity: body.quantity,
      durationMs: result.durationMs,
      orderId: order.id,
    });
    return result;
  }

  @Post('demo/checkout/webhook')
  async checkoutWebhook(@Body(new ZodPipe(checkoutSchema)) body: z.infer<typeof checkoutSchema>) {
    const start = performance.now();
    const pending = await this.ordersService.createPending(body.userId, [{ productId: body.productId, quantity: body.quantity }]);
    const payment = await this.payments.start(pending.fakePaymentRef, true);
    const result = { mode: 'webhook', requestDurationMs: Math.round(performance.now() - start), order: pending.order, payment };
    await this.logger.write('checkout', 'webhook_request_returned', {
      userId: body.userId,
      productId: body.productId,
      quantity: body.quantity,
      requestDurationMs: result.requestDurationMs,
      orderId: pending.order.id,
      providerDelayMs: payment.delayMs,
    });
    return result;
  }

  @Post('demo/checkout/acid-direct')
  async checkoutAcidDirect(@Body(new ZodPipe(acidDirectSchema)) body: z.infer<typeof acidDirectSchema>) {
    const before = await this.acidSnapshot();
    let result: { committed: boolean; error?: string; orderId?: number; total?: string; lockedProductIds?: number[] };

    try {
      const checkout = await this.ordersService.acidDirectCheckout(body.userId, body.items, body.failPayment);
      result = {
        committed: true,
        orderId: checkout.order.id,
        total: checkout.total,
        lockedProductIds: checkout.lockedProductIds,
      };
    } catch (error) {
      result = { committed: false, error: error instanceof Error ? error.message : String(error) };
    }

    const after = await this.acidSnapshot();
    const expectedDebit = Number(result.total ?? 0);
    const summary = {
      scenario: body.failPayment ? 'direct-checkout-forced-rollback' : 'direct-checkout-commit',
      result,
      before,
      after,
      proof: body.failPayment
        ? after.walletBalance === before.walletBalance && after.productStock === before.productStock && after.orderCount === before.orderCount
          ? 'PASS: payment failure rolled back wallet, stock, order, and order item changes'
          : 'FAIL: rollback did not restore all tables'
        : result.committed &&
            Number(after.walletBalance) === Number(before.walletBalance) - expectedDebit &&
            after.productStock < before.productStock &&
            after.orderCount === before.orderCount + 1
          ? 'PASS: wallet debit, stock update, order creation, and payment status committed together'
          : 'FAIL: commit did not update all expected tables',
    };
    await this.logger.write('acid', 'direct_checkout_completed', summary);
    return summary;
  }

  @Post('demo/compare/checkout')
  async compareCheckout(@Body(new ZodPipe(checkoutSchema)) body: z.infer<typeof checkoutSchema>) {
    const sync = await this.checkoutSync(body);
    const webhook = await this.checkoutWebhook(body);
    return {
      topic: 'Asynchronous processing',
      withoutCorrectStructure: sync,
      withCorrectStructure: webhook,
      conclusion: {
        responseImprovementMs: sync.durationMs - webhook.requestDurationMs,
        result: webhook.requestDurationMs < sync.durationMs ? 'PASS: user response returns faster while work continues in background' : 'CHECK RESULTS',
      },
    };
  }

  @Post('demo/batch/all-at-once')
  async batchAllAtOnce() {
    const start = performance.now();
    const rows = await this.database.pool.query('SELECT * FROM orders WHERE created_at::date = current_date');
    const totalRevenue = rows.rows.reduce((sum, order) => sum + Number(order.total), 0);
    const rowsHeldAtOnce = rows.rowCount ?? 0;
    const estimatedRowBytes = 256;
    const summary = {
      mode: 'all-at-once',
      processed: rows.rowCount,
      totalRevenue,
      durationMs: Math.round(performance.now() - start),
      rowsHeldAtOnce,
      estimatedWorkingSetBytes: rowsHeldAtOnce * estimatedRowBytes,
    };
    await this.logger.write('batch', 'all_at_once_completed', summary);
    return summary;
  }

  @Post('demo/batch/chunked')
  async batchChunked() {
    const chunkSize = 500;
    const start = performance.now();
    let offset = 0;
    let processed = 0;
    let totalRevenue = 0;
    let maxRowsHeldAtOnce = 0;
    while (true) {
      const rows = await this.database.pool.query('SELECT id, total FROM orders WHERE created_at::date = current_date ORDER BY id LIMIT $1 OFFSET $2', [chunkSize, offset]);
      if (rows.rowCount === 0) break;
      processed += rows.rowCount ?? 0;
      maxRowsHeldAtOnce = Math.max(maxRowsHeldAtOnce, rows.rowCount ?? 0);
      totalRevenue += rows.rows.reduce((sum, order) => sum + Number(order.total), 0);
      offset += chunkSize;
    }
    const estimatedRowBytes = 256;
    const summary = {
      mode: 'chunked',
      chunkSize,
      processed,
      totalRevenue,
      durationMs: Math.round(performance.now() - start),
      maxRowsHeldAtOnce,
      estimatedWorkingSetBytes: maxRowsHeldAtOnce * estimatedRowBytes,
    };
    await this.logger.write('batch', 'chunked_completed', summary);
    return summary;
  }

  @Post('demo/batch/background-job')
  async batchBackgroundJob() {
    const job = await this.queues.enqueueDailySalesSummary();
    return { queued: true, queue: 'reports', jobId: job.id, purpose: 'daily sales summary processed in chunks by a background worker' };
  }

  @Post('demo/batch/seed-orders')
  async seedBatchOrders() {
    const inserted = await this.database.pool.query(`
      INSERT INTO orders (user_id, status, payment_status, total, fake_payment_ref)
      SELECT 1, 'confirmed', 'succeeded', ((gs % 9) + 1) * 25, 'batch-demo-' || gs || '-' || extract(epoch from clock_timestamp())
      FROM generate_series(1, 1200) AS gs
      RETURNING id
    `);
    await this.logger.write('batch', 'seeded_demo_orders', { ordersInserted: inserted.rowCount });
    return { insertedOrders: inserted.rowCount, purpose: 'enough rows to demonstrate multiple 500-row chunks' };
  }

  @Post('demo/compare/batch')
  async compareBatch() {
    const allAtOnce = await this.batchAllAtOnce();
    const chunked = await this.batchChunked();
    return {
      topic: 'Batch processing',
      withoutCorrectStructure: allAtOnce,
      withCorrectStructure: chunked,
      conclusion: {
        rowsAvoidedInMemoryAtOnce: allAtOnce.rowsHeldAtOnce - chunked.maxRowsHeldAtOnce,
        estimatedWorkingSetSavedBytes: allAtOnce.estimatedWorkingSetBytes - chunked.estimatedWorkingSetBytes,
        result: chunked.maxRowsHeldAtOnce < allAtOnce.rowsHeldAtOnce ? 'PASS: chunking reduces the maximum rows held in memory at once' : 'CHECK RESULTS',
      },
    };
  }

  @Post('demo/acid/transaction')
  async acidTransaction(@Body(new ZodPipe(acidSchema)) body: z.infer<typeof acidSchema>) {
    const before = await this.acidSnapshot();
    let result: { committed: boolean; error?: string; orderId?: number };

    try {
      const orderId = await this.database.transaction(async (client) => {
        const orderResult = await client.query(
          "INSERT INTO orders (user_id, status, payment_status, total, fake_payment_ref) VALUES (1, 'pending_payment', 'pending', 120, 'acid-demo-' || extract(epoch from clock_timestamp())) RETURNING id",
        );
        const orderId = orderResult.rows[0].id;

        await client.query('UPDATE wallets SET balance = balance - 120, updated_at = now() WHERE user_id = 1');
        await client.query('UPDATE products SET stock = stock - 1, updated_at = now() WHERE id = 1');

        if (body.fail) {
          throw new Error('Forced failure after wallet and stock updates, before order confirmation');
        }

        await client.query("UPDATE orders SET status = 'confirmed', payment_status = 'succeeded', updated_at = now() WHERE id = $1", [orderId]);
        return orderId;
      });

      result = { committed: true, orderId };
    } catch (error) {
      result = { committed: false, error: error instanceof Error ? error.message : String(error) };
    }

    const after = await this.acidSnapshot();
    const summary = {
      scenario: body.fail ? 'forced-rollback' : 'successful-commit',
      result,
      before,
      after,
      proof: body.fail
        ? after.walletBalance === before.walletBalance && after.productStock === before.productStock && after.orderCount === before.orderCount
          ? 'PASS: forced failure rolled back wallet, product, and order changes'
          : 'FAIL: rollback did not restore all tables'
        : Number(after.walletBalance) === Number(before.walletBalance) - 120 && after.productStock === before.productStock - 1 && after.orderCount === before.orderCount + 1
          ? 'PASS: wallet, product, and order changes committed together'
          : 'FAIL: commit did not update all expected tables',
    };
    await this.logger.write('acid', 'transaction_demo_completed', summary);
    return summary;
  }

  @Post('demo/benchmark/n-plus-one')
  async benchmarkNPlusOne() {
    const productRows = await this.database.pool.query('SELECT id, name FROM products ORDER BY id');

    const slowStart = performance.now();
    const slowRows: Array<{ id: number; name: string; soldQuantity: number }> = [];
    let slowQueryCount = 1;
    for (const product of productRows.rows) {
      const sold = await this.database.pool.query(
        `
          SELECT COALESCE(SUM(oi.quantity), 0)::int AS sold_quantity
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = $1 AND o.status = 'confirmed'
        `,
        [product.id],
      );
      slowQueryCount += 1;
      slowRows.push({ ...product, soldQuantity: sold.rows[0].sold_quantity });
    }
    const slowDurationMs = Math.round(performance.now() - slowStart);

    const optimizedStart = performance.now();
    const optimized = await this.database.pool.query(`
      SELECT
        p.id,
        p.name,
        COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'confirmed'), 0)::int AS sold_quantity
      FROM products p
      LEFT JOIN order_items oi ON oi.product_id = p.id
      LEFT JOIN orders o ON o.id = oi.order_id
      GROUP BY p.id, p.name
      ORDER BY p.id
    `);
    const optimizedDurationMs = Math.round(performance.now() - optimizedStart);

    const summary = {
      topic: 'Benchmarking and bottleneck analysis',
      bottleneck: 'N+1 database queries while calculating product sales totals',
      beforeOptimization: {
        strategy: 'one query for products, then one sales query per product',
        queryCount: slowQueryCount,
        durationMs: slowDurationMs,
        rows: slowRows,
      },
      afterOptimization: {
        strategy: 'single aggregate SQL query with JOIN and GROUP BY',
        queryCount: 1,
        durationMs: optimizedDurationMs,
        rows: optimized.rows,
      },
      improvement: {
        queriesReducedBy: slowQueryCount - 1,
        durationImprovementMs: slowDurationMs - optimizedDurationMs,
        result: optimizedDurationMs <= slowDurationMs && slowQueryCount > 1 ? 'PASS: aggregate query removes the N+1 bottleneck' : 'CHECK RESULTS',
      },
    };
    await this.logger.write('benchmark', 'n_plus_one_benchmark_completed', summary);
    return summary;
  }

  @Post('demo/stress/checkout-100')
  stress100() {
    return this.runStress(100);
  }

  @Post('demo/stress/checkout-200')
  stress200() {
    return this.runStress(200);
  }

  @Get('demo/load-balancer/ping')
  ping() {
    const result = { instance: process.env.INSTANCE_NAME ?? 'app-local', port: process.env.PORT ?? 3000 };
    void this.logger.write('load-balancer', 'request_handled', result);
    return result;
  }

  @Get('demo/dashboard/status')
  async status() {
    const [product] = await this.database.db.select().from(products).where(eq(products.id, 1));
    const [wallet] = await this.database.db.select().from(wallets).where(eq(wallets.userId, 1));
    const recentOrders = await this.database.pool.query(
      'SELECT id, user_id, status, payment_status, total, created_at FROM orders ORDER BY id DESC LIMIT 10',
    );
    const recentJobs = await this.database.pool.query('SELECT * FROM job_logs ORDER BY id DESC LIMIT 10');
    const summaries = await this.database.pool.query('SELECT * FROM daily_sales_summaries ORDER BY id DESC LIMIT 10');
    const tableCounts = await this.database.pool.query(`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM products) AS products,
        (SELECT count(*)::int FROM orders) AS orders,
        (SELECT count(*)::int FROM order_items) AS order_items,
        (SELECT count(*)::int FROM job_logs) AS job_logs,
        (SELECT count(*)::int FROM daily_sales_summaries) AS daily_sales_summaries
    `);
    return {
      instance: process.env.INSTANCE_NAME ?? 'app-local',
      product,
      wallet,
      orders: await this.ordersService.countByStatus(),
      queues: await this.queues.counts(),
      tableCounts: tableCounts.rows[0],
      recentOrders: recentOrders.rows,
      recentJobs: recentJobs.rows,
      dailySalesSummaries: summaries.rows,
      memory: process.memoryUsage(),
    };
  }

  private async runRace(productId: number, requests: number, safe: boolean) {
    await this.database.db.update(products).set({ stock: requests, version: 0, updatedAt: new Date() }).where(eq(products.id, productId));
    await this.redis.del('products:popular:v1', `product:${productId}`);
    const started = performance.now();
    const results = await Promise.allSettled(
      Array.from({ length: requests }, () => (safe ? this.ordersService.safeBuy(productId, 1) : this.ordersService.unsafeBuy(productId, 1))),
    );
    const [product] = await this.database.db.select().from(products).where(eq(products.id, productId));
    const summary = {
      mode: safe ? 'safe' : 'unsafe',
      initialStock: requests,
      finalStock: product.stock,
      successfulOrders: results.filter((result) => result.status === 'fulfilled').length,
      failedOrders: results.filter((result) => result.status === 'rejected').length,
      durationMs: Math.round(performance.now() - started),
    };
    await this.logger.write('race', safe ? 'safe_run_completed' : 'unsafe_run_completed', summary);
    return summary;
  }

  private async runRedisLock(productId: number, requests: number) {
    await this.database.db.update(products).set({ stock: requests, version: 0, updatedAt: new Date() }).where(eq(products.id, productId));
    await this.redis.del('products:popular:v1', `product:${productId}`);
    const started = performance.now();
    const results = await Promise.allSettled(Array.from({ length: requests }, () => this.ordersService.redisLockedBuy(productId, 1)));
    const [product] = await this.database.db.select().from(products).where(eq(products.id, productId));
    const summary = {
      mode: 'redis-lock',
      lock: `locks:inventory:${productId}`,
      initialStock: requests,
      finalStock: product.stock,
      successfulOrders: results.filter((result) => result.status === 'fulfilled').length,
      failedOrders: results.filter((result) => result.status === 'rejected').length,
      durationMs: Math.round(performance.now() - started),
    };
    await this.logger.write('redis-lock', 'redis_lock_run_completed', summary);
    return summary;
  }

  private async runOptimisticLock(productId: number, requests: number) {
    await this.database.db.update(products).set({ stock: requests, version: 0, updatedAt: new Date() }).where(eq(products.id, productId));
    await this.redis.del('products:popular:v1', `product:${productId}`);
    const started = performance.now();
    const results = await Promise.allSettled(Array.from({ length: requests }, () => this.ordersService.optimisticBuy(productId, 1)));
    const [product] = await this.database.db.select().from(products).where(eq(products.id, productId));
    const summary = {
      mode: 'optimistic-lock',
      initialStock: requests,
      finalStock: product.stock,
      finalVersion: product.version,
      successfulOrders: results.filter((result) => result.status === 'fulfilled').length,
      failedOrders: results.filter((result) => result.status === 'rejected').length,
      durationMs: Math.round(performance.now() - started),
      invariant:
        product.stock >= 0 && product.stock + results.filter((result) => result.status === 'fulfilled').length === requests
          ? 'PASS: version check prevents lost updates and overselling'
          : 'FAIL: optimistic locking invariant failed',
    };
    await this.logger.write('optimistic-lock', 'optimistic_lock_run_completed', summary);
    return summary;
  }

  private async resourceWork(total: number, concurrency: number, controlled: boolean) {
    const start = performance.now();
    let active = 0;
    let peakActive = 0;
    const task = async () => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise((resolve) => setTimeout(resolve, 60));
      active -= 1;
    };
    if (controlled) {
      const queue = Array.from({ length: total });
      const workers = Array.from({ length: concurrency }, async () => {
        while (queue.length > 0) {
          queue.pop();
          await task();
        }
      });
      await Promise.all(workers);
    } else {
      await Promise.all(Array.from({ length: total }, () => task()));
    }
    const summary = { mode: controlled ? 'controlled' : 'uncontrolled', total, concurrencyLimit: controlled ? concurrency : null, peakActive, durationMs: Math.round(performance.now() - start), memory: process.memoryUsage() };
    await this.logger.write('resource-management', controlled ? 'controlled_run_completed' : 'uncontrolled_run_completed', {
      total,
      concurrencyLimit: summary.concurrencyLimit,
      peakActive,
      durationMs: summary.durationMs,
      reason: controlled ? 'work was capped to reduce pressure' : 'all work started at once',
    });
    return summary;
  }

  private async runStress(requests: number) {
    await this.database.db.update(products).set({ stock: requests, version: 0, updatedAt: new Date() }).where(eq(products.id, 1));
    await this.redis.del('products:popular:v1', 'product:1');
    const before = await this.snapshot();
    const started = performance.now();
    const results = await Promise.allSettled(
      Array.from({ length: requests }, async () => {
        const pending = await this.ordersService.createPending(1, [{ productId: 1, quantity: 1 }]);
        return this.ordersService.confirmPayment(pending.fakePaymentRef, true);
      }),
    );
    const after = await this.snapshot();
    const rejected = results
      .filter((result) => result.status === 'rejected')
      .map((result) => (result.status === 'rejected' ? String(result.reason?.message ?? result.reason) : ''));
    const summary = {
      scenario: `checkout-${requests}`,
      virtualUsers: requests,
      durationMs: Math.round(performance.now() - started),
      successfulRequests: results.filter((result) => result.status === 'fulfilled').length,
      failedRequests: results.filter((result) => result.status === 'rejected').length,
      before,
      after,
      invariant:
        after.productStock === 0 && after.orderCount - before.orderCount === requests
          ? 'PASS: no lost updates and every checkout produced an order'
          : 'FAIL: stock or order-count mismatch',
    };
    await this.logger.write('stress', 'checkout_stress_completed', {
      requests,
      successfulRequests: summary.successfulRequests,
      failedRequests: summary.failedRequests,
      failureReasons: rejected,
      durationMs: summary.durationMs,
      before,
      after,
      invariant: summary.invariant,
    });
    return summary;
  }

  private async snapshot() {
    const [product] = await this.database.db.select().from(products).where(eq(products.id, 1));
    const counts = await this.database.pool.query('SELECT count(*)::int AS orders FROM orders');
    return { productStock: product.stock, orderCount: counts.rows[0].orders };
  }

  private async acidSnapshot() {
    const rows = await this.database.pool.query(`
      SELECT
        (SELECT balance::text FROM wallets WHERE user_id = 1) AS wallet_balance,
        (SELECT stock FROM products WHERE id = 1) AS product_stock,
        (SELECT count(*)::int FROM orders) AS order_count,
        (SELECT count(*)::int FROM orders WHERE status = 'confirmed' AND payment_status = 'succeeded') AS confirmed_orders
    `);
    return {
      walletBalance: rows.rows[0].wallet_balance,
      productStock: rows.rows[0].product_stock,
      orderCount: rows.rows[0].order_count,
      confirmedOrders: rows.rows[0].confirmed_orders,
    };
  }
}
