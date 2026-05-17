import { Body, Controller, Get, Post } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { DatabaseService } from '../db/database.service';
import { products } from '../db/schema';
import { ZodPipe } from '../validation/zod.pipe';

const createProductSchema = z.object({
  name: z.string().min(1),
  price: z.coerce.number().positive(),
  stock: z.coerce.number().int().nonnegative(),
});

@Controller('products')
export class ProductsController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  list() {
    return this.database.db.select().from(products).orderBy(asc(products.id));
  }

  @Post()
  create(@Body(new ZodPipe(createProductSchema)) body: z.infer<typeof createProductSchema>) {
    return this.database.db.insert(products).values({ ...body, price: body.price.toFixed(2) }).returning();
  }
}
