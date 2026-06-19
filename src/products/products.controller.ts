import { Body, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DatabaseService } from '../db/database.service';
import { products } from '../db/schema';
import { ZodPipe } from '../validation/zod.pipe';
import { RedisService } from '../redis/redis.service';
import { ExperimentLoggerService } from '../logging/experiment-logger.service';

const createProductSchema = z.object({
  name: z.string().min(1),
  price: z.coerce.number().positive(),
  stock: z.coerce.number().int().nonnegative(),
});

@Controller('products')
export class ProductsController {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly logger: ExperimentLoggerService,
  ) {}

  @Get()
  list() {
    return this.database.db.select().from(products).orderBy(asc(products.id));
  }

  @Get('popular')
  async popular() {
    const cacheKey = 'products:popular:v1';
    const cached = await this.redis.getJson<unknown[]>(cacheKey);
    if (cached) {
      await this.logger.write('cache', 'popular_products_cache_hit', { key: cacheKey, count: cached.length });
      return { source: 'redis-cache', cache: 'hit', products: cached };
    }

    const result = await this.database.pool.query(`
      SELECT
        p.id,
        p.name,
        p.price,
        p.stock,
        COALESCE(SUM(oi.quantity), 0)::int AS sold_quantity
      FROM products p
      LEFT JOIN order_items oi ON oi.product_id = p.id
      GROUP BY p.id
      ORDER BY sold_quantity DESC, p.id ASC
      LIMIT 10
    `);
    await this.redis.setJson(cacheKey, result.rows, 60);
    await this.logger.write('cache', 'popular_products_cache_miss', { key: cacheKey, count: result.rows.length, ttlSeconds: 60 });
    return { source: 'postgres-db', cache: 'miss', products: result.rows };
  }

  @Delete('popular/cache')
  async clearPopularCache() {
    await this.redis.del('products:popular:v1');
    await this.logger.write('cache', 'popular_products_cache_cleared', { key: 'products:popular:v1' });
    return { cleared: true, key: 'products:popular:v1', nextRequest: 'miss' };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const cacheKey = `product:${id}`;
    const cached = await this.redis.getJson<unknown>(cacheKey);
    if (cached) {
      await this.logger.write('cache', 'product_detail_cache_hit', { key: cacheKey, productId: id });
      return { source: 'redis-cache', cache: 'hit', product: cached };
    }

    const [product] = await this.database.db.select().from(products).where(eq(products.id, id));
    if (!product) throw new NotFoundException('Product not found');

    await this.redis.setJson(cacheKey, product, 60);
    await this.logger.write('cache', 'product_detail_cache_miss', { key: cacheKey, productId: id, ttlSeconds: 60 });
    return { source: 'postgres-db', cache: 'miss', product };
  }

  @Post()
  async create(@Body(new ZodPipe(createProductSchema)) body: z.infer<typeof createProductSchema>) {
    const created = await this.database.db.insert(products).values({ ...body, price: body.price.toFixed(2) }).returning();
    await this.redis.del('products:popular:v1');
    await this.logger.write('cache', 'popular_products_cache_invalidated', { reason: 'product_created' });
    return created;
  }
}
