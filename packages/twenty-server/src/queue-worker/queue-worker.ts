import { NestFactory } from '@nestjs/core';

import { companyAuthEnabled } from 'src/engine/core-modules/company-auth/company-auth.config';

import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { LoggerService } from 'src/engine/core-modules/logger/logger.service';
import { shouldCaptureException } from 'src/engine/utils/global-exception-handler.util';
import 'src/instrument';
import { QueueWorkerModule } from 'src/queue-worker/queue-worker.module';

async function bootstrap() {
  if (companyAuthEnabled())
    throw new Error('Company workers require separately reviewed scoped jobs');

  let exceptionHandlerService: ExceptionHandlerService | undefined;
  let loggerService: LoggerService | undefined;

  try {
    const app = await NestFactory.createApplicationContext(QueueWorkerModule, {
      bufferLogs: process.env.LOGGER_IS_BUFFER_ENABLED === 'true',
    });

    loggerService = app.get(LoggerService);
    exceptionHandlerService = app.get(ExceptionHandlerService);

    // Inject our logger
    app.useLogger(loggerService ?? false);
  } catch (err) {
    loggerService?.error(err?.message, err?.name);

    if (shouldCaptureException(err)) {
      exceptionHandlerService?.captureExceptions([err]);
    }

    throw err;
  }
}
bootstrap();
