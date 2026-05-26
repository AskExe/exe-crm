import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import crypto from 'node:crypto';

import { addMilliseconds } from 'date-fns';
import ms from 'ms';
import { Repository } from 'typeorm';

import {
  AppTokenEntity,
  AppTokenType,
} from 'src/engine/core-modules/app-token/app-token.entity';
import { ApplicationRegistrationService } from 'src/engine/core-modules/application/application-registration/application-registration.service';
import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { type AuthorizeAppDTO } from 'src/engine/core-modules/auth/dto/authorize-app.dto';
import { type AuthorizeAppInput } from 'src/engine/core-modules/auth/dto/authorize-app.input';
import { validateRedirectUri } from 'src/engine/core-modules/auth/utils/validate-redirect-uri.util';
import { AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Injectable()
// oxlint-disable-next-line exe-crm/inject-workspace-repository
export class AuthOAuthAuthorizationService {
  constructor(
    private readonly applicationRegistrationService: ApplicationRegistrationService,
    @InjectRepository(AppTokenEntity)
    private readonly appTokenRepository: Repository<AppTokenEntity>,
  ) {}

  async generateAuthorizationCode(
    authorizeAppInput: AuthorizeAppInput,
    user: AuthContextUser,
    workspace: WorkspaceEntity,
  ): Promise<AuthorizeAppDTO> {
    const { clientId, codeChallenge } = authorizeAppInput;

    const applicationRegistration =
      await this.applicationRegistrationService.findOneByClientId(clientId);

    if (!applicationRegistration) {
      throw new AuthException(
        `Client not found for '${clientId}'`,
        AuthExceptionCode.CLIENT_NOT_FOUND,
      );
    }

    if (!authorizeAppInput.redirectUrl) {
      throw new AuthException(
        `redirectUrl not provided for '${clientId}'`,
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    // RFC 8252 §7.3: Native apps using loopback redirect URIs may use any port.
    // When a registration has no explicit redirect URIs (e.g. the seeded CLI registration),
    // allow any loopback redirect URI.
    const hasRegisteredRedirectUris =
      applicationRegistration.oAuthRedirectUris.length > 0;

    if (hasRegisteredRedirectUris) {
      if (
        !applicationRegistration.oAuthRedirectUris.includes(
          authorizeAppInput.redirectUrl,
        )
      ) {
        throw new AuthException(
          `redirectUrl mismatch for '${clientId}'`,
          AuthExceptionCode.FORBIDDEN_EXCEPTION,
        );
      }
    } else {
      let redirectUrl: URL;

      try {
        redirectUrl = new URL(authorizeAppInput.redirectUrl);
      } catch {
        throw new AuthException(
          `Invalid redirectUrl for '${clientId}'`,
          AuthExceptionCode.FORBIDDEN_EXCEPTION,
        );
      }

      const isLoopback =
        redirectUrl.hostname === 'localhost' ||
        redirectUrl.hostname === '127.0.0.1';

      if (!isLoopback) {
        throw new AuthException(
          `redirectUrl mismatch for '${clientId}'`,
          AuthExceptionCode.FORBIDDEN_EXCEPTION,
        );
      }
    }

    // Validate requested scopes are a subset of the registration's allowed scopes
    const parsedScopes = authorizeAppInput.scope
      ? authorizeAppInput.scope.split(' ').filter(Boolean)
      : [];

    const requestedScopes =
      parsedScopes.length > 0
        ? parsedScopes
        : applicationRegistration.oAuthScopes;

    const invalidScopes = requestedScopes.filter(
      (scope) => !applicationRegistration.oAuthScopes.includes(scope),
    );

    if (invalidScopes.length > 0) {
      throw new AuthException(
        `Invalid scopes: ${invalidScopes.join(', ')}`,
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    const redirectUriValidation = validateRedirectUri(
      authorizeAppInput.redirectUrl,
    );

    if (!redirectUriValidation.valid) {
      throw new AuthException(
        redirectUriValidation.reason,
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    const authorizationCode = crypto.randomBytes(42).toString('hex');
    const hashedAuthorizationCode = crypto
      .createHash('sha256')
      .update(authorizationCode)
      .digest('hex');

    const expiresAt = addMilliseconds(new Date().getTime(), ms('5m'));

    const authCodeContext = {
      redirectUri: authorizeAppInput.redirectUrl,
      clientId: applicationRegistration.oAuthClientId,
      scope: requestedScopes.join(' '),
      ...(codeChallenge ? { codeChallenge } : {}),
    };

    const token = this.appTokenRepository.create({
      value: hashedAuthorizationCode,
      type: AppTokenType.AuthorizationCode,
      userId: user.id,
      workspaceId: workspace.id,
      expiresAt,
      context: authCodeContext,
    });

    await this.appTokenRepository.save(token);

    redirectUriValidation.parsed.searchParams.set('code', authorizationCode);

    if (authorizeAppInput.state) {
      redirectUriValidation.parsed.searchParams.set(
        'state',
        authorizeAppInput.state,
      );
    }

    return { redirectUrl: redirectUriValidation.parsed.toString() };
  }
}
