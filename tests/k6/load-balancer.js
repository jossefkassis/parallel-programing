import http from 'k6/http';
export const options = { vus: 10, iterations: 100 };
export default function () {
  http.get('http://localhost:8080/api/demo/load-balancer/ping');
}
