import http from 'k6/http';
export const options = { vus: 50, duration: '20s' };
export default function () {
  http.post('http://localhost:3000/api/demo/resource/uncontrolled');
}
