import { Injectable } from '@nestjs/common';
import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class ExperimentLoggerService {
  private readonly dir = join(process.cwd(), 'logs');

  async write(caseName: string, event: string, data: Record<string, unknown> = {}) {
    await mkdir(this.dir, { recursive: true });
    const entry = {
      time: new Date().toISOString(),
      instance: process.env.INSTANCE_NAME ?? 'app-local',
      case: caseName,
      event,
      ...data,
    };
    const line = `${JSON.stringify(entry)}\n`;
    await Promise.all([
      appendFile(join(this.dir, 'all-experiments.jsonl'), line),
      appendFile(join(this.dir, `${caseName}.jsonl`), line),
    ]);
  }
}
