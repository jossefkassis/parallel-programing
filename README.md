# NestJS E-Commerce Parallel Programming Demo

Stack: NestJS, TypeScript, Drizzle ORM, PostgreSQL, Zod, BullMQ, Redis, Prometheus, Grafana, Nginx, k6.

## Setup

```bash
cp .env.example .env
docker compose -f docker-compose.local.yml up -d postgres redis prometheus grafana nginx
pnpm install
pnpm db:migrate
pnpm db:seed
```

Run one local instance:

```bash
pnpm start:dev
```

Run the load-balancing demo with two instances:

```bash
$env:PORT=3001; $env:INSTANCE_NAME="app1"; pnpm start:dev
$env:PORT=3002; $env:INSTANCE_NAME="app2"; pnpm start:dev
```

Nginx listens on `http://localhost:8080`.

## Main URLs

- API health for app1: `http://localhost:3001/api/health`
- Dashboard through Nginx: `http://localhost:8080/dashboard`
- Metrics for app1: `http://localhost:3001/metrics`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3003`

## k6

```bash
k6 run tests/k6/race-unsafe.js
k6 run tests/k6/race-safe.js
k6 run tests/k6/resource-uncontrolled.js
k6 run tests/k6/resource-controlled.js
k6 run tests/k6/checkout-sync.js
k6 run tests/k6/checkout-webhook.js
k6 run tests/k6/stress-checkout-100.js
k6 run tests/k6/stress-checkout-200.js
k6 run tests/k6/load-balancer.js
```

By default, non-load-balancer k6 scripts target `http://localhost:3001`.  
Override when needed:

```bash
k6 run -e APP_BASE_URL=http://localhost:3002 tests/k6/checkout-webhook.js
k6 run -e APP_BASE_URL=http://localhost:8080 tests/k6/stress-checkout-100.js
```

## Evidence dashboard

Open `/dashboard` for screenshot-ready demonstrations:

- run side-by-side comparison experiments for unsafe vs safe, uncontrolled vs controlled, sync vs async, and all-at-once vs chunked
- queue a real daily-sales background job that processes orders in chunks
- run 100-user or 200-user checkout stress tests from the browser
- capture before/after stock, order counts, recent orders, queue jobs, and daily sales summaries in one place

After pulling these changes, run `pnpm db:migrate` once to create the `daily_sales_summaries` table.

Arabic submission files:

- `docs/report-ar.md`
- `docs/testing-and-screenshots-ar.md`
- `docs/report-screenshot-plan.md`
- `docs/logging-evidence-guide.md`

The Laravel folder is not used by this project.
