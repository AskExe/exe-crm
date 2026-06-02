import { type LogLevel } from '@nestjs/common';

import pino from 'pino';

// Map NestJS log levels to pino levels
const NEST_TO_PINO_LEVEL: Record<string, string> = {
  verbose: 'trace',
  debug: 'debug',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

const pinoLevelFromNest = (nestLevel: string): string =>
  NEST_TO_PINO_LEVEL[nestLevel] ?? 'info';

// Determine the minimum pino level from the NestJS log-level list
const resolveMinPinoLevel = (logLevels: LogLevel[]): string => {
  const pinoOrder = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

  let minIndex = pinoOrder.length - 1;

  for (const nl of logLevels) {
    const pl = pinoLevelFromNest(nl);
    const idx = pinoOrder.indexOf(pl);

    if (idx !== -1 && idx < minIndex) {
      minIndex = idx;
    }
  }

  return pinoOrder[minIndex];
};

export class PinoDriver {
  private logger: pino.Logger;
  public options: { logLevels?: LogLevel[] };

  constructor() {
    const isDev = process.env.NODE_ENV === 'development';

    this.options = { logLevels: ['log', 'error', 'warn'] };

    this.logger = pino({
      level: 'info',
      ...(isDev
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
            },
          }
        : {}),
      formatters: {
        level: (label: string) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  setLogLevels(levels: LogLevel[]) {
    this.options.logLevels = levels;
    this.logger.level = resolveMinPinoLevel(levels);
  }

  // oxlint-disable-next-line @typescripttypescript/no-explicit-any
  log(message: any, context?: string, ...args: any[]) {
    this.logger.info(
      { context, args: args.length ? args : undefined },
      String(message),
    );
  }

  // oxlint-disable-next-line @typescripttypescript/no-explicit-any
  error(message: any, context?: string, ...args: any[]) {
    // NestJS sometimes passes the stack trace as the second arg
    if (context && typeof context === 'string' && context.includes('\n')) {
      this.logger.error(
        { stack: context, args: args.length ? args : undefined },
        String(message),
      );
    } else {
      this.logger.error(
        { context, args: args.length ? args : undefined },
        String(message),
      );
    }
  }

  // oxlint-disable-next-line @typescripttypescript/no-explicit-any
  warn(message: any, context?: string, ...args: any[]) {
    this.logger.warn(
      { context, args: args.length ? args : undefined },
      String(message),
    );
  }

  // oxlint-disable-next-line @typescripttypescript/no-explicit-any
  debug(message: any, context?: string, ...args: any[]) {
    this.logger.debug(
      { context, args: args.length ? args : undefined },
      String(message),
    );
  }

  // oxlint-disable-next-line @typescripttypescript/no-explicit-any
  verbose(message: any, context?: string, ...args: any[]) {
    this.logger.trace(
      { context, args: args.length ? args : undefined },
      String(message),
    );
  }
}
