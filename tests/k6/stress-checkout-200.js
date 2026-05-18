import http from 'k6/http';
import { check } from 'k6';
import { APP_BASE_URL } from './config.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const response = http.post(`${APP_BASE_URL}/api/demo/stress/checkout-200`);
  check(response, {
    'stress endpoint succeeded': (r) => r.status === 201 || r.status === 200,
    'all 200 succeeded': (r) => r.json('successfulRequests') === 200,
    'no failed requests': (r) => r.json('failedRequests') === 0,
    'invariant passed': (r) => String(r.json('invariant')).startsWith('PASS'),
  });
}
