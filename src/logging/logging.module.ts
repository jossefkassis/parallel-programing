import { Global, Module } from '@nestjs/common';
import { ExperimentLoggerService } from './experiment-logger.service';

@Global()
@Module({
  providers: [ExperimentLoggerService],
  exports: [ExperimentLoggerService],
})
export class LoggingModule {}
