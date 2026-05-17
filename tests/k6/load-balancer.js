import http from 'k6/http';
import { BALANCER_BASE_URL } from './config.js';
export const options = { vus: 10, iterations: 100 };
export default function () {
  http.get(`${BALANCER_BASE_URL}/api/demo/load-balancer/ping`);
}
