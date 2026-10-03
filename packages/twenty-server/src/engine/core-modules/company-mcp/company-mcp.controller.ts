import { All, Controller, HttpException, Req, Res } from '@nestjs/common';
import { type Request, type Response } from 'express';

import {
  CompanyProtocolError,
  COMPANY_MCP_DEADLINE_MS,
} from './company-mcp.protocol';
import { CompanyMcpService } from './company-mcp.service';

@Controller('company-mcp')
export class CompanyMcpController {
  constructor(private readonly companyMcp: CompanyMcpService) {}

  // Authentication and native ACL are enforced by the bounded company service,
  // without legacy JWT/native-key guards or an unrestricted permission marker.
  // oxlint-disable-next-line exe-crm/rest-api-methods-should-be-guarded
  @All()
  async handle(
    @Req() request: Request & { rawBody?: Buffer },
    @Res() response: Response,
  ) {
    const controller = new AbortController();
    const deadline = setTimeout(
      () => controller.abort(),
      COMPANY_MCP_DEADLINE_MS,
    );
    const disconnected = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once('close', disconnected);
    response.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    try {
      const result = await this.companyMcp.handle(request, controller.signal);
      if (controller.signal.aborted)
        throw new HttpException('Company read unavailable', 503);
      if (result.status === 405) response.set('Allow', 'POST');
      if (!response.destroyed) {
        response.status(result.status);
        if (result.value) response.json(result.value);
        else response.end();
      }
    } catch (error) {
      const status = controller.signal.aborted
        ? 503
        : error instanceof HttpException
          ? error.getStatus()
          : error instanceof CompanyProtocolError
            ? 400
            : 503;
      if (!response.destroyed)
        response.status(status).json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: error instanceof CompanyProtocolError ? error.code : -32000,
            message:
              status === 503
                ? 'Company service unavailable'
                : 'Company request denied',
          },
        });
    } finally {
      clearTimeout(deadline);
      response.removeListener('close', disconnected);
    }
  }
}
