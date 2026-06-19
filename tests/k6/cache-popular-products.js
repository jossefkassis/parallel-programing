import http from 'k6/http';
import { check } from 'k6';
import { APP_BASE_URL } from './config.js';

export const options = { vus: 10, iterations: 30 };

export default function () {
  const response = http.get(`${APP_BASE_URL}/api/products/popular`);
  check(response, {
    'popular products endpoint succeeded': (r) => r.status === 200,
    'cache source is reported': (r) => ['hit', 'miss'].includes(r.json('cache')),
  });
}
