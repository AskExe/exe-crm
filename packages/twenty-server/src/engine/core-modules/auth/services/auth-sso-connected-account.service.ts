import { Injectable } from '@nestjs/common';

import { ConnectedAccountProvider, FeatureFlagKey } from 'twenty-shared/types';

import { CreateSSOConnectedAccountService } from 'src/engine/core-modules/auth/services/create-sso-connected-account.service';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';

@Injectable()
export class AuthSSOConnectedAccountService {
  constructor(
    private readonly featureFlagService: FeatureFlagService,
    private readonly createSSOConnectedAccountService: CreateSSOConnectedAccountService,
  ) {}

  async createSSOConnectedAccountIfFeatureFlagIsOn(input: {
    workspaceId: string;
    userId: string;
    handle: string;
    authProvider:
      | AuthProviderEnum.Google
      | AuthProviderEnum.Microsoft
      | AuthProviderEnum.SSO;
    oidcTokenClaims?: Record<string, unknown>;
    connectedAccountProvider?: ConnectedAccountProvider;
  }): Promise<void> {
    const isConnectedAccountMigrated =
      await this.featureFlagService.isFeatureEnabled(
        FeatureFlagKey.IS_CONNECTED_ACCOUNT_MIGRATED,
        input.workspaceId,
      );

    // const willBeEnabledByDefault = DEFAULT_FEATURE_FLAGS.includes(FeatureFlagKey.IS_CONNECTED_ACCOUNT_MIGRATED);
    const willBeEnabledByDefault = false;

    if (!isConnectedAccountMigrated && !willBeEnabledByDefault) {
      return;
    }

    const provider =
      input.connectedAccountProvider ??
      this.mapAuthProviderToConnectedAccountProvider(input.authProvider);

    const scopes = this.getSSOScopes(provider);

    await this.createSSOConnectedAccountService.createOrUpdateSSOConnectedAccount(
      {
        workspaceId: input.workspaceId,
        userId: input.userId,
        handle: input.handle,
        provider,
        scopes,
        oidcTokenClaims: input.oidcTokenClaims,
      },
    );
  }

  mapAuthProviderToConnectedAccountProvider(
    authProvider:
      | AuthProviderEnum.Google
      | AuthProviderEnum.Microsoft
      | AuthProviderEnum.SSO,
  ): ConnectedAccountProvider {
    switch (authProvider) {
      case AuthProviderEnum.Google:
        return ConnectedAccountProvider.GOOGLE;
      case AuthProviderEnum.Microsoft:
        return ConnectedAccountProvider.MICROSOFT;
      case AuthProviderEnum.SSO:
        return ConnectedAccountProvider.OIDC;
      default:
        throw new Error(
          `Unsupported auth provider: ${authProvider satisfies never}`,
        );
    }
  }

  getSSOScopes(provider: ConnectedAccountProvider): string[] {
    switch (provider) {
      case ConnectedAccountProvider.GOOGLE:
        return ['email', 'profile'];
      case ConnectedAccountProvider.MICROSOFT:
        return ['user.read'];
      case ConnectedAccountProvider.OIDC:
        return ['openid', 'email', 'profile'];
      case ConnectedAccountProvider.SAML:
        return [];
      case ConnectedAccountProvider.IMAP_SMTP_CALDAV:
        return [];
      default:
        throw new Error(
          `Unsupported connected account provider: ${provider satisfies never}`,
        );
    }
  }
}
