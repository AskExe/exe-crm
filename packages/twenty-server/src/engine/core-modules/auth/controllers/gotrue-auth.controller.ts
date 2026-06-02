import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import { type Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { RefreshTokenService } from 'src/engine/core-modules/auth/token/services/refresh-token.service';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';

/**
 * /api/auth/gotrue-login  — email + password via GoTrue → Twenty access token
 * /api/auth/admin-token   — admin token bypass → Twenty access token
 *
 * GoTrue is the identity provider. After GoTrue validates the credentials,
 * we mint a native Twenty access+refresh token pair that works with all
 * downstream CRM GraphQL resolvers (workspace context, user context, etc.).
 */
@Controller('api/auth')
export class GoTrueAuthController {
  private readonly logger = new Logger(GoTrueAuthController.name);
  private readonly gotrueUrl: string | undefined;
  private readonly adminToken: string | undefined;

  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly signInUpService: SignInUpService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
  ) {
    this.gotrueUrl = process.env.GOTRUE_URL || process.env.EXE_GOTRUE_URL;
    this.adminToken = process.env.EXE_CRM_ADMIN_TOKEN;
  }

  /**
   * Find the first workspace (single-tenant: only one workspace exists).
   */
  private async getWorkspace(): Promise<WorkspaceEntity | null> {
    return this.workspaceRepository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Find or log the user+workspace association.
   */
  private async getUserContext(email: string) {
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) return null;

    const workspace = await this.getWorkspace();

    if (!workspace) return null;

    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { userId: user.id, workspaceId: workspace.id },
    });

    return { user, workspace, userWorkspace };
  }

  /**
   * Generate a Twenty-native token pair that works with all CRM endpoints.
   */
  private async generateTokenPair(userId: string, workspaceId: string) {
    const accessToken = await this.accessTokenService.generateAccessToken({
      userId,
      workspaceId,
      authProvider: AuthProviderEnum.SSO,
    });

    const refreshToken = await this.refreshTokenService.generateRefreshToken(
      userId,
      workspaceId,
    );

    return {
      accessToken: { token: accessToken.token, expiresAt: accessToken.expiresAt },
      refreshToken: { token: refreshToken.token, expiresAt: refreshToken.expiresAt },
    };
  }

  @Post('gotrue-login')
  async gotrueLogin(
    @Body() body: { email?: string; password?: string },
    @Res() res: Response,
  ) {
    const { email, password } = body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!this.gotrueUrl) {
      return res.status(500).json({ error: 'GoTrue is not configured' });
    }

    // Step 1: Authenticate with GoTrue
    let gotrueData: { access_token?: string; user?: { email?: string } };

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
          error: errBody?.error_description || errBody?.msg || 'Invalid email or password',
        });
      }

      gotrueData = await gotrueRes.json();
    } catch (err) {
      this.logger.error(`GoTrue request failed: ${err}`);

      return res.status(502).json({ error: 'Authentication service unavailable' });
    }

    // Step 2: Find user in CRM DB, or auto-provision on first login
    let ctx = await this.getUserContext(email);

    if (!ctx) {
      this.logger.log(`GoTrue login OK — auto-provisioning ${email} in CRM`);

      try {
        const result = await this.signInUpService.signUpOnNewWorkspace({
          type: 'newUserWithPicture',
          newUserWithPicture: {
            email,
            firstName: gotrueData.user?.email?.split('@')[0] ?? 'User',
            lastName: '',
            picture: null,
          },
        });

        // Refresh context after provisioning
        ctx = await this.getUserContext(email);

        if (!ctx) {
          throw new Error('User context missing after provisioning');
        }

        this.logger.log(
          `Auto-provisioned: user=${ctx.user.id} workspace=${ctx.workspace.id}`,
        );
      } catch (provisionErr) {
        this.logger.error(`Auto-provision failed for ${email}: ${provisionErr}`);

        return res.status(500).json({
          error: 'Failed to set up your account. Please try again or contact admin.',
        });
      }
    }

    // Step 3: Generate CRM-native token pair
    try {
      const tokens = await this.generateTokenPair(ctx.user.id, ctx.workspace.id);

      this.logger.log(`GoTrue login: ${email} → CRM token issued`);

      return res.json({
        tokens,
        user: { id: ctx.user.id, email: ctx.user.email },
      });
    } catch (err) {
      this.logger.error(`Token generation failed for ${email}: ${err}`);

      return res.status(500).json({ error: 'Failed to generate session token' });
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
      return res.status(500).json({ error: 'Admin token not configured' });
    }

    if (token !== this.adminToken) {
      return res.status(401).json({ error: 'Invalid admin token' });
    }

    // Find the first user in the first workspace (admin bypass)
    const workspace = await this.getWorkspace();

    if (!workspace) {
      return res.status(500).json({ error: 'No workspace found' });
    }

    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { workspaceId: workspace.id },
      order: { createdAt: 'ASC' },
    });

    if (!userWorkspace) {
      return res.status(500).json({ error: 'No user found in workspace' });
    }

    try {
      const tokens = await this.generateTokenPair(
        userWorkspace.userId,
        workspace.id,
      );

      this.logger.log(`Admin token login → Twenty token issued`);

      return res.json({
        tokens,
        user: { id: userWorkspace.userId },
        isAdminToken: true,
      });
    } catch (err) {
      this.logger.error(`Admin token generation failed: ${err}`);

      return res.status(500).json({ error: 'Failed to generate session token' });
    }
  }
}
