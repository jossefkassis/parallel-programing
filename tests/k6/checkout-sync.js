import http from 'k6/http';
import { APP_BASE_URL } from './config.js';
export const options = { vus: 5, iterations: 10 };
export default function () {
  http.post(`${APP_BASE_URL}/api/demo/checkout/sync`, JSON.stringify({ userId: 1, productId: 1, quantity: 1 }), { headers: { 'Content-Type': 'application/json' } });
}
