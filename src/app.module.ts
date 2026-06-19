import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { join } from 'path';
import { DemoModule } from './demo/demo.module';
import { MetricsModule } from './metrics/metrics.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { DatabaseModule } from './db/database.module';
import { ProductsModule } from './products/products.module';
import { QueuesModule } from './queues/queues.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';
import { LoggingModule } from './logging/logging.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      serveRoot: '/dashboard',
      renderPath: '/dashboard',
    }),
    ThrottlerModule.forRoot([{ ttl: 1000, limit: 50 }]),
    DatabaseModule,
    LoggingModule,
    RedisModule,
    MetricsModule,
    QueuesModule,
    ProductsModule,
    UsersModule,
    OrdersModule,
    PaymentsModule,
    DemoModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
