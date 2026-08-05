import { HttpException, HttpStatus } from '@nestjs/common';

import { ErrorForwardingFilter } from '../error-forwarding.filter';
import { ErrorForwardingService } from '../error-forwarding.service';

const createMockHost = (
  overrides: Partial<{ url: string; method: string }> = {},
) => {
  const mockRequest = {
    originalUrl: overrides.url ?? '/api/test',
    url: overrides.url ?? '/api/test',
    method: overrides.method ?? 'GET',
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
  };

  const mockResponse = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  return {
    switchToHttp: () => ({
      getRequest: () => mockRequest,
      getResponse: () => mockResponse,
    }),
    mockResponse,
  };
};

describe('ErrorForwardingFilter', () => {
  let filter: ErrorForwardingFilter;
  let service: ErrorForwardingService;

  beforeEach(() => {
    service = {
      forwardBackendError: jest.fn(),
    } as unknown as ErrorForwardingService;

    filter = new ErrorForwardingFilter(service);
  });

  it('should forward 5xx errors to monitor', () => {
    const error = new Error('Internal failure');
    const { mockResponse, ...host } = createMockHost();

    filter.catch(error, host as never);

    expect(service.forwardBackendError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Internal failure',
        statusCode: 500,
        method: 'GET',
        url: '/api/test',
      }),
    );
    expect(mockResponse.status).toHaveBeenCalledWith(500);
  });

  it('should not forward 4xx errors', () => {
    const error = new HttpException('Not found', HttpStatus.NOT_FOUND);
    const { mockResponse, ...host } = createMockHost();

    filter.catch(error, host as never);

    expect(service.forwardBackendError).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(404);
  });

  it('should forward HttpException with 500+ status', () => {
    const error = new HttpException(
      'Service unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    const { mockResponse, ...host } = createMockHost();

    filter.catch(error, host as never);

    expect(service.forwardBackendError).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 503,
        message: 'Service unavailable',
      }),
    );
    expect(mockResponse.status).toHaveBeenCalledWith(503);
  });
});
