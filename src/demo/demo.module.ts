import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { QueuesModule } from '../queues/queues.module';
import { DemoController } from './demo.controller';

@Module({
  imports: [OrdersModule, PaymentsModule, QueuesModule],
  controllers: [DemoController],
})
export class DemoModule {}
