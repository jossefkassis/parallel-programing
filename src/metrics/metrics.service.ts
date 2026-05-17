import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status', 'instance'],
    registers: [this.registry],
  });
  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status', 'instance'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [this.registry],
  });
  readonly queueJobs = new Gauge({
    name: 'bullmq_jobs',
    help: 'BullMQ jobs by queue and state',
    labelNames: ['queue', 'state', 'instance'],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'nodejs_',
      eventLoopMonitoringPrecision: 10,
    });
  }
}
