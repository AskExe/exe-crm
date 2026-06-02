import { Body, Controller, Post, Res } from '@nestjs/common';
import { type Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

/**
 * /api/auth/gotrue-login  — email + password via GoTrue
 * /api/auth/admin-token   — admin token bypass
 *
 * Both return { token, email } where token is the GoTrue access_token
 * (or admin token) that can be sent as Authorization: Bearer on all
 * subsequent CRM API requests.  The JwtAuthGuard already validates
 * GoTrue JWTs and admin tokens, so no Twenty-native token generation
 * is needed here.
 */
@Controller('api/auth')
export class GoTrueAuthController {
  private readonly gotrueUrl: string | undefined;
  private readonly adminToken: string | undefined;

  constructor(
    private readonly configService: TwentyConfigService,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
  ) {
    this.gotrueUrl = process.env.GOTRUE_URL || process.env.EXE_GOTRUE_URL;
    this.adminToken = process.env.EXE_CRM_ADMIN_TOKEN;
  }

  @Post('gotrue-login')
  async gotrueLogin(
    @Body() body: { email?: string; password?: string },
    @Res() res: Response,
  ) {
    const { email, password } = body ?? {};

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: 'Email and password are required' });
    }

    if (!this.gotrueUrl) {
      return res
        .status(500)
        .json({ error: 'GoTrue is not configured on this server' });
    }

    try {
      const gotrueRes = await fetch(
        `${this.gotrueUrl}/token?grant_type=password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!gotrueRes.ok) {
        const errBody = await gotrueRes.json().catch(() => ({}));

        return res.status(401).json({
          error:
            errBody?.error_description ||
            errBody?.msg ||
            'Invalid email or password',
        });
      }

      const data = await gotrueRes.json();

      return res.json({
        token: data.access_token,
        refreshToken: data.refresh_token,
        email: data.user?.email ?? email,
        expiresIn: data.expires_in,
      });
    } catch (err) {
      return res.status(502).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to reach authentication service',
      });
    }
  }

  @Post('admin-token')
  async adminTokenLogin(
    @Body() body: { token?: string },
    @Res() res: Response,
  ) {
    const { token } = body ?? {};

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    if (!this.adminToken) {
      return res
        .status(500)
        .json({ error: 'Admin token is not configured on this server' });
    }

    if (token !== this.adminToken) {
      return res.status(401).json({ error: 'Invalid admin token' });
    }

    // Return the admin token itself — the AdminTokenMiddleware will
    // validate it on subsequent requests via the Authorization header.
    return res.json({
      token: this.adminToken,
      email: 'admin',
      isAdminToken: true,
    });
  }
}
