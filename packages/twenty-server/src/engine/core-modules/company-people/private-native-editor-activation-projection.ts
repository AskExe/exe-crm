import { type NativeEditorScopes } from './private-native-editor-activation-correspondence';

export type NativeEditorActivationProjection = Readonly<{
  version: 2;
  entitlement_kind: 'beta';
  commerce: null;
  purpose: 'native-identity-activation';
  action: 'crm:native-identity:activate';
  product: 'crm';
  resource_kind: 'crm-workspace';
  current_role: 'owner' | 'member';
  verified_email: string;
  email_confirmed_at: string;
  identity_sha256: string;
  subject_id: string;
  company_id: string;
  client_id: string;
  binding_id: string;
  native_id: string;
  generation_id: string;
  authz_epoch: string;
  audience: string;
  policy_revision: string;
  activation_scopes: NativeEditorScopes;
  request_id: string;
  payload_sha256: string;
  expires_at: string;
  parent_session_id: string;
  parent_exp: string;
  attempt: 1;
  coordinator_id: string;
}>;
export const PROJECTION_KEYS = [
  'version',
  'entitlement_kind',
  'commerce',
  'purpose',
  'action',
  'product',
  'resource_kind',
  'current_role',
  'verified_email',
  'email_confirmed_at',
  'identity_sha256',
  'subject_id',
  'company_id',
  'client_id',
  'binding_id',
  'native_id',
  'generation_id',
  'authz_epoch',
  'audience',
  'policy_revision',
  'activation_scopes',
  'request_id',
  'payload_sha256',
  'expires_at',
  'parent_session_id',
  'parent_exp',
  'attempt',
  'coordinator_id',
];
