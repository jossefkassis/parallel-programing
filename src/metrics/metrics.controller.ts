import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('/metrics')
  @Header('Content-Type', 'text/plain')
  async metricsText() {
    return this.metrics.registry.metrics();
  }
}
