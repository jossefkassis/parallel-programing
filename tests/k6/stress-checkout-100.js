import http from 'k6/http';
import { check } from 'k6';
import { APP_BASE_URL } from './config.js';

export const options = { vus: 100, iterations: 100 };

export default function () {
  const response = http.post(
    `${APP_BASE_URL}/api/demo/checkout/webhook`,
    JSON.stringify({ userId: 1, productId: 1, quantity: 1 }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(response, { 'accepted': (r) => r.status === 201 || r.status === 200 });
}
