// Stub: exe-os uses GoTrue for auth, not Twenty SSO
import { registerEnumType } from '@nestjs/graphql';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';

export enum IdentityProviderType {
  OIDC = 'OIDC',
  SAML = 'SAML',
}

export enum SSOIdentityProviderStatus {
  Active = 'Active',
  Inactive = 'Inactive',
  Error = 'Error',
}

registerEnumType(IdentityProviderType, { name: 'IdentityProviderType' });
registerEnumType(SSOIdentityProviderStatus, { name: 'SSOIdentityProviderStatus' });

@Entity({ name: 'workspaceSSOIdentityProvider', schema: 'core' })
export class WorkspaceSSOIdentityProviderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  type: IdentityProviderType;

  @Column({ nullable: true })
  issuer: string;

  @Column({ nullable: true })
  workspaceId: string;

  @ManyToOne(
    'WorkspaceEntity',
    (workspace: { workspaceSSOIdentityProviders: WorkspaceSSOIdentityProviderEntity[] }) =>
      workspace.workspaceSSOIdentityProviders,
  )
  @JoinColumn({ name: 'workspaceId' })
  // oxlint-disable-next-line @typescript/no-explicit-any
  workspace: Relation<any>;

  @Column({ nullable: true })
  ssoURL: string;

  @Column({ nullable: true })
  certificate: string;

  @Column({ nullable: true })
  status: SSOIdentityProviderStatus;
}
