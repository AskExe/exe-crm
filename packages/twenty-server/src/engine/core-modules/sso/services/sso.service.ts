// Stub: exe-os uses GoTrue for auth, not upstream SSO
import { Injectable } from '@nestjs/common';

import { type SSOConfiguration } from 'src/engine/core-modules/sso/types/SSOConfigurations.type';
import { type WorkspaceSSOIdentityProviderEntity } from 'src/engine/core-modules/sso/workspace-sso-identity-provider.entity';

@Injectable()
export class SSOService {
  async findSSOIdentityProviderById(
    _id: string,
  ): Promise<
    (SSOConfiguration & WorkspaceSSOIdentityProviderEntity) | null
  > {
    return null;
  }

  buildIssuerURL(
    _provider: Pick<WorkspaceSSOIdentityProviderEntity, 'id' | 'type'>,
  ): string {
    return '';
  }

  buildCallbackUrl(
    _provider: Pick<WorkspaceSSOIdentityProviderEntity, 'id' | 'type'>,
  ): string {
    return '';
  }

  isSAMLIdentityProvider(
    _provider: SSOConfiguration & WorkspaceSSOIdentityProviderEntity,
  ): _provider is SSOConfiguration & WorkspaceSSOIdentityProviderEntity & {
    ssoURL: string;
    certificate: string;
  } {
    return false;
  }

  // oxlint-disable-next-line @typescript/no-explicit-any
  getOIDCClient(_provider: any, _issuer: any): any {
    return null;
  }

  async getAuthorizationUrlForSSO(
    _identityProviderId: string,
    _params?: Record<string, unknown>,
  ) {
    return { authorizationURL: '', type: '', id: '' };
  }
}
