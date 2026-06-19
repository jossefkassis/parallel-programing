import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { DatabaseService } from '../db/database.service';
import { jobLogs } from '../db/schema';
import { ExperimentLoggerService } from '../logging/experiment-logger.service';

@Injectable()
export class QueuesService implements OnModuleInit, OnModuleDestroy {
  private connection: IORedis;
  readonly invoices: Queue;
  readonly notifications: Queue;
  readonly reports: Queue;
  private workers: Worker[] = [];
  private dailyTimer?: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly logger: ExperimentLoggerService,
  ) {
    this.connection = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      maxRetriesPerRequest: null,
    });
    this.invoices = new Queue('invoices', { connection: this.connection });
    this.notifications = new Queue('notifications', { connection: this.connection });
    this.reports = new Queue('reports', { connection: this.connection });
  }

  onModuleInit() {
    const concurrency = Number(process.env.QUEUE_CONCURRENCY ?? 4);
    this.workers = [
      new Worker('invoices', async (job) => this.logJob('invoice', job.data), { connection: this.connection, concurrency }),
      new Worker('notifications', async (job) => this.logJob('notification', job.data), { connection: this.connection, concurrency }),
      new Worker('reports', async (job) => this.processDailySalesSummary(job.data), { connection: this.connection, concurrency: 1 }),
    ];
    this.dailyTimer = setInterval(() => this.enqueueDailySalesSummary(), 24 * 60 * 60 * 1000);
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((worker) => worker.close()));
    if (this.dailyTimer) clearInterval(this.dailyTimer);
    await Promise.all([this.invoices.close(), this.notifications.close(), this.reports.close()]);
    await this.connection.quit();
  }

  async enqueueAfterPayment(orderId: number) {
    await this.invoices.add('generate', { orderId }, { attempts: 3, backoff: { type: 'exponential', delay: 500 } });
    await this.notifications.add('send', { orderId }, { attempts: 3, backoff: { type: 'exponential', delay: 500 } });
  }

  async enqueueDailySalesSummary(salesDate = new Date()) {
    return this.reports.add('daily-sales-summary', { salesDate: salesDate.toISOString() }, { attempts: 3, backoff: { type: 'exponential', delay: 500 } });
  }

  async counts() {
    const entries = await Promise.all(
      [this.invoices, this.notifications, this.reports].map(async (queue) => ({
        queue: queue.name,
        counts: await queue.getJobCounts('waiting', 'active', 'completed', 'failed'),
      })),
    );
    return entries;
  }

  private async logJob(type: string, payload: unknown) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await this.database.db.insert(jobLogs).values({ type, status: 'completed', payload });
    await this.logger.write('queues', 'job_completed', { type, payload });
  }

  private async processDailySalesSummary(payload: { salesDate: string }) {
    const chunkSize = 500;
    const salesDay = payload.salesDate.slice(0, 10);
    const salesDate = new Date(`${salesDay}T00:00:00.000Z`);
    let offset = 0;
    let processedOrders = 0;
    let totalRevenue = 0;

    while (true) {
      const rows = await this.database.pool.query(
        'SELECT id, total FROM orders WHERE created_at::date = $1::date ORDER BY id LIMIT $2 OFFSET $3',
        [salesDay, chunkSize, offset],
      );
      if (rows.rowCount === 0) break;
      processedOrders += rows.rowCount ?? 0;
      totalRevenue += rows.rows.reduce((sum, order) => sum + Number(order.total), 0);
      offset += chunkSize;
      await this.logger.write('batch', 'chunk_processed', {
        chunkSize,
        processedInChunk: rows.rowCount,
        processedOrders,
        offset,
      });
    }

    await this.database.pool.query(
      `
        INSERT INTO daily_sales_summaries (sales_date, processed_orders, total_revenue, chunk_size)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (sales_date)
        DO UPDATE SET
          processed_orders = EXCLUDED.processed_orders,
          total_revenue = EXCLUDED.total_revenue,
          chunk_size = EXCLUDED.chunk_size
      `,
      [salesDate, processedOrders, totalRevenue.toFixed(2), chunkSize],
    );
    await this.logJob('daily-sales-summary', { salesDate: payload.salesDate, processedOrders, totalRevenue, chunkSize });
    await this.logger.write('batch', 'daily_sales_summary_completed', { processedOrders, totalRevenue, chunkSize });
    return { processedOrders, totalRevenue, chunkSize };
  }
}
