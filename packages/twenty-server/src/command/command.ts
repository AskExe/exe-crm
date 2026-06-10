import { CommandFactory } from 'nest-commander';

import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { LoggerService } from 'src/engine/core-modules/logger/logger.service';
import { shouldCaptureException } from 'src/engine/utils/global-exception-handler.util';

import { CommandModule } from './command.module';

async function bootstrap() {
  const errorHandler = (err: Error) => {
    loggerService.error(err?.message, err?.name);

    if (shouldCaptureException(err)) {
      exceptionHandlerService.captureExceptions([err]);
    }
  };

  const app = await CommandFactory.createWithoutRunning(CommandModule, {
    logger: ['error', 'warn', 'log'],
    bufferLogs: process.env.LOGGER_IS_BUFFER_ENABLED === 'true',
    errorHandler,
    serviceErrorHandler: errorHandler,
  });
  const loggerService = app.get(LoggerService);
  const exceptionHandlerService = app.get(ExceptionHandlerService);

  // Inject our logger
  app.useLogger(loggerService);

  await CommandFactory.runApplication(app);

  // Graceful shutdown: await close so NestJS runs onModuleDestroy hooks
  // (Redis quit, TypeORM disconnect, etc.). Without await, the process hangs
  // because open connections keep the event loop alive.
  // Safety timeout: force exit if close itself hangs (e.g., stuck Redis conn).
  const forceExitTimer = setTimeout(() => {
    loggerService.warn(
      'app.close() did not finish within 10 s — forcing exit',
    );
    process.exit(0);
  }, 10_000);

  // Unref so the timer alone doesn't keep the process alive
  forceExitTimer.unref();

  await app.close();
}
bootstrap();
