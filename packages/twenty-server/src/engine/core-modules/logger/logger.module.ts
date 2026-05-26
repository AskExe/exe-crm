import {
  ConsoleLogger,
  type DynamicModule,
  Global,
  Module,
} from '@nestjs/common';

import { PinoDriver } from 'src/engine/core-modules/logger/drivers/pino.driver';
import { LoggerDriverType } from 'src/engine/core-modules/logger/interfaces';
import { LOGGER_DRIVER } from 'src/engine/core-modules/logger/logger.constants';
import {
  type ASYNC_OPTIONS_TYPE,
  ConfigurableModuleClass,
  type OPTIONS_TYPE,
} from 'src/engine/core-modules/logger/logger.module-definition';
import { LoggerService } from 'src/engine/core-modules/logger/logger.service';

const createLoggerDriver = (type: LoggerDriverType) => {
  switch (type) {
    case LoggerDriverType.PINO:
      return new PinoDriver();
    case LoggerDriverType.CONSOLE:
    default:
      return new ConsoleLogger();
  }
};

@Global()
@Module({
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule extends ConfigurableModuleClass {
  static forRoot(options: typeof OPTIONS_TYPE): DynamicModule {
    const provider = {
      provide: LOGGER_DRIVER,
      useValue: createLoggerDriver(options.type),
    };
    const dynamicModule = super.forRoot(options);

    return {
      ...dynamicModule,
      providers: [...(dynamicModule.providers ?? []), provider],
    };
  }

  static forRootAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
    const provider = {
      provide: LOGGER_DRIVER,
      // oxlint-disable-next-line @typescripttypescript/no-explicit-any
      useFactory: async (...args: any[]) => {
        const config = await options?.useFactory?.(...args);

        if (!config) {
          return null;
        }

        const logLevels = config.logLevels ?? [];
        const logger = createLoggerDriver(config.type);

        logger?.setLogLevels(logLevels);

        return logger;
      },
      inject: options.inject || [],
    };
    const dynamicModule = super.forRootAsync(options);

    return {
      ...dynamicModule,
      providers: [...(dynamicModule.providers ?? []), provider],
    };
  }
}
