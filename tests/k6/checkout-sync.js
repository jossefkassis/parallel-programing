import http from 'k6/http';
export const options = { vus: 5, iterations: 10 };
export default function () {
  http.post('http://localhost:3000/api/demo/checkout/sync', JSON.stringify({ userId: 1, productId: 1, quantity: 1 }), { headers: { 'Content-Type': 'application/json' } });
}
