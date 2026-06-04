import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';

import fs from 'fs';

import bytes from 'bytes';
import { useContainer } from 'class-validator';
import session from 'express-session';
import graphqlUploadExpress from 'graphql-upload/graphqlUploadExpress.mjs';

import { NodeEnvironment } from 'src/engine/core-modules/twenty-config/interfaces/node-environment.interface';

import { setPgDateTypeParser } from 'src/database/pg/set-pg-date-type-parser';
import { LoggerService } from 'src/engine/core-modules/logger/logger.service';
import { getSessionStorageOptions } from 'src/engine/core-modules/session-storage/session-storage.module-factory';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { UnhandledExceptionFilter } from 'src/filters/unhandled-exception.filter';
import { isOriginAllowed } from 'src/utils/cors/is-origin-allowed.util';

import { AppModule } from './app.module';
import './instrument';

import { settings } from './engine/constants/settings';
import { generateFrontConfig } from './utils/generate-front-config';

const assertAppSecret = () => {
  const secret = process.env.APP_SECRET;

  if (
    !secret ||
    secret === 'replace_me_with_a_random_string' ||
    secret.length < 32
  ) {
    throw new Error(
      'APP_SECRET must be set to a secure random string of at least 32 chars. ' +
        'Generate with: openssl rand -hex 32',
    );
  }
};

const isPlaceholderValue = (value: string) =>
  /^(changeme|replace_me|your_|example)/i.test(value);

const assertExeLicenseKey = () => {
  const licenseKey = process.env.EXE_LICENSE_KEY ?? process.env.ENTERPRISE_KEY;

  if (!licenseKey || isPlaceholderValue(licenseKey)) {
    throw new Error(
      'EXE_LICENSE_KEY must be set to a real enterprise key before Exe CRM can boot. ' +
        'Obtain a valid key from https://askexe.com.',
    );
  }

  process.env.EXE_LICENSE_KEY = licenseKey;
  process.env.ENTERPRISE_KEY = process.env.ENTERPRISE_KEY ?? licenseKey;
};

// Trigger
const bootstrap = async () => {
  assertAppSecret();
  assertExeLicenseKey();

  setPgDateTypeParser();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: false,
    bufferLogs: process.env.LOGGER_IS_BUFFER_ENABLED === 'true',
    rawBody: true,
    snapshot: process.env.NODE_ENV === NodeEnvironment.DEVELOPMENT,
    ...(process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH
      ? {
          httpsOptions: {
            key: fs.readFileSync(process.env.SSL_KEY_PATH),
            cert: fs.readFileSync(process.env.SSL_CERT_PATH),
          },
        }
      : {}),
  });
  const logger = app.get(LoggerService);
  const twentyConfigService = app.get(TwentyConfigService);
  const workspaceDomainsService = app.get(WorkspaceDomainsService);

  app.enableCors({
    credentials: true,
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'Origin',
      'X-Requested-With',
      'x-locale',
      'X-Schema-Version',
      'X-App-Version',
    ],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    origin: (origin, callback) => {
      void isOriginAllowed({
        origin,
        twentyConfigService,
        workspaceDomainsService,
      })
        .then((allowed) =>
          callback(
            allowed ? null : new Error('Origin not allowed by CORS'),
            allowed,
          ),
        )
        .catch((error) => callback(error, false));
    },
  });

  app.use(session(getSessionStorageOptions(twentyConfigService)));

  // Apply class-validator container so that we can use injection in validators
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  // Use our logger
  app.useLogger(logger);

  app.useGlobalFilters(
    new UnhandledExceptionFilter(twentyConfigService, workspaceDomainsService),
  );

  app.useBodyParser('json', { limit: settings.storage.maxFileSize });
  app.useBodyParser('urlencoded', {
    limit: settings.storage.maxFileSize,
    extended: true,
  });

  // Graphql file upload
  app.use(
    '/graphql',
    graphqlUploadExpress({
      maxFieldSize: bytes(settings.storage.maxFileSize)!,
      maxFiles: 10,
    }),
  );

  app.use(
    '/metadata',
    graphqlUploadExpress({
      maxFieldSize: bytes(settings.storage.maxFileSize)!,
      maxFiles: 10,
    }),
  );

  // Inject the server url in the frontend page
  generateFrontConfig();

  // Enable graceful shutdown — drains connections and runs onApplicationShutdown hooks
  // on SIGTERM/SIGINT (Docker sends SIGTERM on container stop)
  app.enableShutdownHooks();

  await app.listen(twentyConfigService.get('NODE_PORT'));
};

bootstrap();
