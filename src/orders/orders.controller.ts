import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../validation/zod.pipe';
import { OrdersService } from './orders.service';

const createOrderSchema = z.object({
  userId: z.coerce.number().int().positive(),
  items: z.array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().positive() })).min(1),
});

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body(new ZodPipe(createOrderSchema)) body: z.infer<typeof createOrderSchema>) {
    return this.orders.createPending(body.userId, body.items);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.orders.get(id);
  }
}
