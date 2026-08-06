import process from 'process';

import opentelemetry from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import {
  AggregationTemporality,
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import * as Sentry from '@sentry/node';

import { NodeEnvironment } from 'src/engine/core-modules/twenty-config/interfaces/node-environment.interface';

import { ExceptionHandlerDriver } from 'src/engine/core-modules/exception-handler/interfaces';
import { MeterDriver } from 'src/engine/core-modules/metrics/types/meter-driver.type';
import { parseArrayEnvVar } from 'src/utils/parse-array-env-var';

const meterDrivers = parseArrayEnvVar(
  process.env.METER_DRIVER,
  Object.values(MeterDriver),
  [],
);

// Loaded lazily and fault-tolerantly: @sentry/profiling-node requires a
// platform-specific native prebuilt (e.g. sentry_cpu_profiler-linux-x64-musl-<ABI>.node).
// A missing prebuilt for the running Node ABI must degrade to "no profiling",
// never crash the server/worker at boot. (This file compiles to CommonJS.)
type ProfilingIntegration = ReturnType<
  (typeof import('@sentry/profiling-node'))['nodeProfilingIntegration']
>;

const loadProfilingIntegration = (): ProfilingIntegration[] => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { nodeProfilingIntegration } =
      require('@sentry/profiling-node') as typeof import('@sentry/profiling-node');

    return [nodeProfilingIntegration()];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      '[instrument] @sentry/profiling-node unavailable, continuing without CPU profiling:',
      error instanceof Error ? error.message : error,
    );

    return [];
  }
};

if (process.env.EXCEPTION_HANDLER_DRIVER === ExceptionHandlerDriver.SENTRY) {
  Sentry.init({
    environment: process.env.SENTRY_ENVIRONMENT,
    release: process.env.APP_VERSION,
    dsn: process.env.SENTRY_DSN,
    integrations: [
      Sentry.redisIntegration(),
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
      Sentry.graphqlIntegration(),
      Sentry.postgresIntegration(),
      Sentry.vercelAIIntegration({
        recordInputs: process.env.NODE_ENV === NodeEnvironment.DEVELOPMENT,
        recordOutputs: process.env.NODE_ENV === NodeEnvironment.DEVELOPMENT,
      }),
      ...loadProfilingIntegration(),
    ],
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.3,
    sendDefaultPii: false,
    debug: process.env.NODE_ENV === NodeEnvironment.DEVELOPMENT,
  });
}

// Meter setup

const prometheusExporter = meterDrivers.includes(MeterDriver.Prometheus)
  ? new PrometheusExporter({ port: 9464 })
  : null;

const meterProvider = new MeterProvider({
  readers: [
    ...(meterDrivers.includes(MeterDriver.Console)
      ? [
          new PeriodicExportingMetricReader({
            exporter: new ConsoleMetricExporter(),
            exportIntervalMillis: 10000,
          }),
        ]
      : []),
    ...(meterDrivers.includes(MeterDriver.OpenTelemetry)
      ? [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
              url: process.env.OTLP_COLLECTOR_METRICS_ENDPOINT_URL,
              temporalityPreference: AggregationTemporality.DELTA,
            }),
            exportIntervalMillis: 10000,
          }),
        ]
      : []),
    ...(prometheusExporter ? [prometheusExporter] : []),
  ],
});

opentelemetry.metrics.setGlobalMeterProvider(meterProvider);
