import http from 'k6/http';
import { APP_BASE_URL } from './config.js';
export const options = { vus: 50, duration: '20s' };
export default function () {
  http.post(`${APP_BASE_URL}/api/demo/resource/controlled`);
}
