import http from 'k6/http';
import { check } from 'k6';
import { APP_BASE_URL } from './config.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const response = http.post(`${APP_BASE_URL}/api/demo/lock/redis`, JSON.stringify({ productId: 1, requests: 25 }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(response, {
    'redis lock endpoint succeeded': (r) => r.status === 201 || r.status === 200,
    'redis lock preserved stock invariant': (r) => r.json('finalStock') === 0,
  });
}
