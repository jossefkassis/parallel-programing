import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startedAt = performance.now();
    const instance = process.env.INSTANCE_NAME ?? 'app-local';
    const originalWriteHead = res.writeHead.bind(res);

    res.setHeader('X-Instance', instance);
    res.writeHead = ((...args: unknown[]) => {
      if (!res.headersSent) {
        res.setHeader('X-Response-Time-Ms', (performance.now() - startedAt).toFixed(1));
      }
      return originalWriteHead(...(args as Parameters<typeof originalWriteHead>));
    }) as Response['writeHead'];

    const end = this.metrics.httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ?? req.path;
      const labels = {
        method: req.method,
        route,
        status: String(res.statusCode),
        instance,
      };
      this.metrics.httpRequests.inc(labels);
      end(labels);
    });
    next();
  }
}
