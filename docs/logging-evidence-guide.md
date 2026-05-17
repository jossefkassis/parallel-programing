# Logging Evidence Guide

The application now writes JSON Lines files into `logs/` while experiments run.

## Main files

- `logs/all-experiments.jsonl` — every experiment in one place
- `logs/race.jsonl` — unsafe vs safe stock updates
- `logs/resource-management.jsonl` — uncontrolled vs controlled concurrency
- `logs/checkout.jsonl` — sync response time, webhook request time, webhook completion time
- `logs/orders.jsonl` — confirmed and failed payment outcomes
- `logs/batch.jsonl` — seed volume, each processed chunk, final summary
- `logs/load-balancer.jsonl` — which instance answered each request
- `logs/stress.jsonl` — successful requests, failed requests, and failure reasons
- `logs/queues.jsonl` — completed background jobs

## Best screenshots from logs

### 1. Load balancing

Run two app instances and then:

```bash
k6 run tests/k6/load-balancer.js
```

Open:

```text
logs/load-balancer.jsonl
```

The file should show alternating `app1` and `app2` entries.

### 2. Resource management

Run:

```bash
k6 run tests/k6/resource-uncontrolled.js
k6 run tests/k6/resource-controlled.js
```

Open:

```text
logs/resource-management.jsonl
```

The evidence to point at is:

- uncontrolled run: high `peakActive`
- controlled run: lower `peakActive`
- the `reason` field explaining the difference

### 3. Sync vs webhook

Run the comparison from the dashboard or API, then open:

```text
logs/checkout.jsonl
```

Use these events:

- `sync_completed`
- `webhook_request_returned`
- `webhook_completed`

This proves that the user-facing webhook request returns quickly, while the full background flow finishes later.

### 4. Failed orders and reasons

Open:

```text
logs/orders.jsonl
logs/stress.jsonl
```

These files record failed payment outcomes and rejected stress-test requests with their reasons.

### 5. Batch processing

Before comparing batch behavior, generate enough data:

```bash
curl -X POST http://localhost:3001/api/demo/batch/seed-orders
```

Then run:

```bash
curl -X POST http://localhost:3001/api/demo/batch/background-job
```

Open:

```text
logs/batch.jsonl
```

You should see multiple `chunk_processed` entries of 500 rows, then a final summary entry.

## Helpful PowerShell commands

Show the last 20 combined log entries:

```powershell
Get-Content logs\all-experiments.jsonl -Tail 20
```

Watch logs live while a test is running:

```powershell
Get-Content logs\all-experiments.jsonl -Wait
```

Show only load-balancer events:

```powershell
Get-Content logs\load-balancer.jsonl
```

## Why this helps the report

Screenshots from the dashboard show outcomes.  
Screenshots from k6 show load.  
Screenshots from Grafana show runtime behavior.  
Screenshots from the log files show the internal sequence of events and the reason behind each result.
