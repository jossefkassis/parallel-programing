# Report Screenshot Plan

## What the instructor is probably asking for

Use three different evidence sources:

1. `/dashboard` for functional comparisons and database evidence.
2. `k6` terminal output for stress-test numbers.
3. Grafana plus Windows Resource Monitor for runtime monitoring outside the app dashboard.

Laravel Telescope is not used here because this project is built with NestJS, not Laravel.  
For NestJS, the monitoring stack is:

- Prometheus: collects metrics from `/metrics`
- Grafana: visualizes request rate, latency, CPU, memory, event loop lag, and queue state
- Windows Resource Monitor: shows per-process CPU and disk activity for `node.exe`

## Required screenshots

### A. Good vs bad behavior

1. Race condition:
   - bad: `unsafe`
   - good: `safe`
2. Resource management:
   - bad: `uncontrolled`
   - good: `controlled`
3. Checkout path:
   - bad/slower: `sync`
   - good/faster: `async`
4. Batch processing:
   - bad: `all-at-once`
   - good: `chunked`

These screenshots come from `/dashboard`.

### B. Load-test evidence

Take terminal screenshots after running:

```bash
k6 run tests/k6/stress-checkout-100.js
k6 run tests/k6/stress-checkout-200.js
```

Each screenshot should clearly show:

- script name
- VUs
- total requests
- `http_req_duration`
- `http_req_failed`
- total test duration

### C. Monitoring evidence outside the dashboard

Open Grafana:

```text
http://localhost:3003
```

Use the provisioned dashboard:

```text
Parallel Programming / NestJS Monitoring
```

Take one screenshot while the app is idle, then another while `k6` is running.  
The second screenshot should show higher:

- request rate
- CPU usage
- memory pressure or event loop lag

### D. CPU and disk usage of the app

Grafana already shows app CPU from Node.js metrics.  
For disk usage, open Windows Resource Monitor:

```text
resmon
```

Then:

1. Go to the **CPU** tab and show `node.exe`.
2. Go to the **Disk** tab and filter or highlight `node.exe`.
3. Run a k6 stress test.
4. Take screenshots while the load is active.

This is useful because disk I/O is an operating-system metric, not something the Nest app itself reports directly.

## Best screenshot order for the final report

1. Architecture / tools overview
2. Race condition: bad vs good
3. Resource control: bad vs good
4. Sync vs async: bad vs good
5. Batch processing: bad vs good
6. k6 100-user result
7. k6 200-user result
8. Grafana idle state
9. Grafana under load
10. Resource Monitor CPU screenshot
11. Resource Monitor disk screenshot
12. Database evidence / background-job result

## One-sentence explanation you can use in the report

The project applies monitoring as a cross-cutting concern through middleware that records request metrics independently from business logic, while Prometheus and Grafana provide external observation of runtime behavior during load tests.
