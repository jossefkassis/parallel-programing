import http from 'k6/http';
import { APP_BASE_URL } from './config.js';
export const options = { vus: 25, iterations: 25 };
export default function () {
  http.post(`${APP_BASE_URL}/api/demo/race/safe`, JSON.stringify({ productId: 1, requests: 25 }), { headers: { 'Content-Type': 'application/json' } });
}
