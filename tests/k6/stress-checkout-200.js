import http from 'k6/http';
import { check } from 'k6';

export const options = { vus: 200, iterations: 200 };

export default function () {
  const response = http.post(
    'http://localhost:3000/api/demo/checkout/webhook',
    JSON.stringify({ userId: 1, productId: 1, quantity: 1 }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(response, { 'accepted': (r) => r.status === 201 || r.status === 200 });
}
