import http from 'k6/http';
export const options = { vus: 25, iterations: 25 };
export default function () {
  http.post('http://localhost:3000/api/demo/race/unsafe', JSON.stringify({ productId: 1, requests: 25 }), { headers: { 'Content-Type': 'application/json' } });
}
