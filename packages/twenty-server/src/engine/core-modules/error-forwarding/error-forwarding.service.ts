import { Injectable, Logger } from '@nestjs/common';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

type ErrorReport = {
  service: string;
  level: 'error' | 'fatal' | 'warn';
  type: 'frontend' | 'backend';
  message: string;
  stack: string | null;
  url: string;
  method: string;
  status_code: number;
  user_id: string;
  release: string;
  timestamp: string;
  metadata: Record<string, unknown>;
};

@Injectable()
export class ErrorForwardingService {
  private readonly logger = new Logger(ErrorForwardingService.name);
  private readonly monitorUrl: string | undefined;
  private readonly enabled: boolean;

  constructor(private readonly twentyConfigService: TwentyConfigService) {
    this.monitorUrl = this.twentyConfigService.get('MONITOR_ERROR_URL');
    this.enabled = this.twentyConfigService.get('ERROR_REPORTING_ENABLED');
  }

  // Fire-and-forget POST to exe-monitor-hub. Never throws.
  forwardError(report: ErrorReport): void {
    if (!this.enabled || !this.monitorUrl) {
      return;
    }

    fetch(this.monitorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => {
        // exe-monitor-hub reachable but rejecting — surface so operators notice
        // sustained CRM->monitor forwarding failures (dropped 5xx reports).
        if (!res.ok) {
          this.logger.warn(
            `exe-monitor-hub returned ${res.status} forwarding error report (report dropped)`,
          );
        }
      })
      .catch((err) => {
        // Network failure / timeout (monitor down). Was debug-only, which hid
        // sustained outages; warn so operators see dropped error reports.
        this.logger.warn(
          `Failed to forward error to exe-monitor-hub (report dropped): ${err.message}`,
        );
      });
  }

  forwardBackendError(params: {
    message: string;
    stack: string | null;
    url: string;
    method: string;
    statusCode: number;
    userId: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.forwardError({
      service: 'exe-crm',
      level: params.statusCode >= 500 ? 'error' : 'warn',
      type: 'backend',
      message: params.message,
      stack: params.stack,
      url: params.url,
      method: params.method,
      status_code: params.statusCode,
      user_id: params.userId,
      release: process.env.npm_package_version ?? 'unknown',
      timestamp: new Date().toISOString(),
      metadata: params.metadata ?? {},
    });
  }

  forwardFrontendError(report: Partial<ErrorReport> & { message: string }): void {
    // Re-stamp service/type and backfill any optional fields the validated
    // payload omitted, so exe-monitor-hub always receives a complete report.
    this.forwardError({
      service: 'exe-crm',
      type: 'frontend',
      message: report.message,
      level: report.level ?? 'error',
      stack: report.stack ?? null,
      url: report.url ?? '',
      method: report.method ?? '',
      status_code: report.status_code ?? 0,
      user_id: report.user_id ?? '',
      release: report.release ?? process.env.npm_package_version ?? 'unknown',
      timestamp: report.timestamp ?? new Date().toISOString(),
      metadata: report.metadata ?? {},
    });
  }
}
