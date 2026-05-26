import { type LogLevel } from '@nestjs/common';

export enum LoggerDriverType {
  CONSOLE = 'CONSOLE',
  PINO = 'PINO',
}

export interface ConsoleDriverFactoryOptions {
  type: LoggerDriverType.CONSOLE;
  logLevels?: LogLevel[];
}

export interface PinoDriverFactoryOptions {
  type: LoggerDriverType.PINO;
  logLevels?: LogLevel[];
}

export type LoggerModuleOptions =
  | ConsoleDriverFactoryOptions
  | PinoDriverFactoryOptions;
