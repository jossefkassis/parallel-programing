import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class PaymentsService {
  constructor(private readonly orders: OrdersService) {}

  sign(payload: object) {
    return createHmac('sha256', process.env.FAKE_PAYMENT_SECRET ?? 'local-secret')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  async start(fakePaymentRef: string, succeed = true) {
    setTimeout(async () => {
      const payload = { fakePaymentRef, success: succeed };
      try {
        await this.handleWebhook(payload, this.sign(payload));
      } catch (error) {
        console.error('Fake payment webhook failed', error);
      }
    }, 2500);
    return { fakePaymentRef, paymentStatus: 'pending', provider: 'fake-local', delayMs: 2500 };
  }

  async handleWebhook(payload: { fakePaymentRef: string; success: boolean }, signature: string) {
    if (this.sign(payload) !== signature) throw new BadRequestException('Invalid fake payment signature');
    return this.orders.confirmPayment(payload.fakePaymentRef, payload.success);
  }
}
