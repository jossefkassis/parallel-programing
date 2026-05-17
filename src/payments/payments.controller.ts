import { Body, Controller, Headers, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../validation/zod.pipe';
import { PaymentsService } from './payments.service';

const startSchema = z.object({ fakePaymentRef: z.string().min(1), succeed: z.boolean().default(true) });
const webhookSchema = z.object({ fakePaymentRef: z.string().min(1), success: z.boolean() });

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payments/fake/start')
  start(@Body(new ZodPipe(startSchema)) body: z.infer<typeof startSchema>) {
    return this.payments.start(body.fakePaymentRef, body.succeed);
  }

  @Post('webhooks/fake-payment')
  webhook(@Body(new ZodPipe(webhookSchema)) body: z.infer<typeof webhookSchema>, @Headers('x-fake-signature') signature = '') {
    return this.payments.handleWebhook(body, signature);
  }
}
