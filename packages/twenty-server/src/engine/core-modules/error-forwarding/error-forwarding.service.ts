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
  private readonly monitorKey: string | undefined;
  private readonly enabled: boolean;

  constructor(private readonly twentyConfigService: TwentyConfigService) {
    this.monitorUrl = this.twentyConfigService.get('MONITOR_ERROR_URL');
    this.monitorKey = this.twentyConfigService.get('MONITOR_API_KEY');
    this.enabled = this.twentyConfigService.get('ERROR_REPORTING_ENABLED');
  }

  // Fire-and-forget POST to exe-monitor-hub. Never throws.
  forwardError(report: ErrorReport): void {
    if (!this.enabled || !this.monitorUrl) {
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.monitorKey) {
      headers['X-Monitor-Key'] = this.monitorKey;
    }

    fetch(this.monitorUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(5000),
    }).catch((err) => {
      this.logger.debug(`Failed to forward error to monitor: ${err.message}`);
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

  forwardFrontendError(report: ErrorReport): void {
    // Re-stamp the service to ensure consistency
    this.forwardError({
      ...report,
      service: 'exe-crm',
      type: 'frontend',
    });
  }
}
