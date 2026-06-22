import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

import { ErrorForwardingService } from '../error-forwarding.service';

const createService = (
  config: Record<string, unknown>,
): ErrorForwardingService => {
  const twentyConfigService = {
    get: jest.fn((key: string) => config[key]),
  } as unknown as TwentyConfigService;

  return new ErrorForwardingService(twentyConfigService);
};

const sampleReport = {
  service: 'exe-crm',
  level: 'error' as const,
  type: 'backend' as const,
  message: 'boom',
  stack: null,
  url: '/api/test',
  method: 'GET',
  status_code: 500,
  user_id: 'user-1',
  release: '1.0.0',
  timestamp: '2026-06-22T00:00:00.000Z',
  metadata: {},
};

describe('ErrorForwardingService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(undefined);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should send X-Monitor-Key header when MONITOR_API_KEY is set', () => {
    const service = createService({
      MONITOR_ERROR_URL: 'https://monitor.example/errors',
      MONITOR_API_KEY: 'super-secret',
      ERROR_REPORTING_ENABLED: true,
    });

    service.forwardError(sampleReport);

    const headers = fetchMock.mock.calls[0][1].headers;

    expect(headers['X-Monitor-Key']).toBe('super-secret');
  });

  it('should omit X-Monitor-Key header when MONITOR_API_KEY is unset', () => {
    const service = createService({
      MONITOR_ERROR_URL: 'https://monitor.example/errors',
      MONITOR_API_KEY: undefined,
      ERROR_REPORTING_ENABLED: true,
    });

    service.forwardError(sampleReport);

    const headers = fetchMock.mock.calls[0][1].headers;

    expect(headers['X-Monitor-Key']).toBeUndefined();
  });
});
