import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import IORedis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new IORedis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    maxRetriesPerRequest: null,
  });

  async onModuleDestroy() {
    await this.client.quit();
  }

  async getJson<T>(key: string): Promise<T | null> {
    const cached = await this.client.get(key);
    return cached ? (JSON.parse(cached) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string) {
    await this.client.del(key);
  }

  async withLock<T>(key: string, ttlMs: number, work: () => Promise<T>, waitMs = 5000): Promise<T> {
    const token = randomUUID();
    const deadline = Date.now() + waitMs;

    while (Date.now() < deadline) {
      const acquired = await this.client.set(key, token, 'PX', ttlMs, 'NX');
      if (acquired === 'OK') {
        try {
          return await work();
        } finally {
          await this.releaseLock(key, token);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Could not acquire Redis lock: ${key}`);
  }

  private async releaseLock(key: string, token: string) {
    await this.client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
  }
}
