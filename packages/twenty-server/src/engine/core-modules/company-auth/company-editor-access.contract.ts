// Generated companion from exe-db company-editor-access; keep v1 unchanged.
// Source SHA256: b9013887d93f41a9f02cdad6ce40a276b035c034cb197f98215831e54adc3328
import {
  companyAccess,
  type CompanyAccess,
  type CompanyBinding,
} from './company-access.contract';

export const COMPANY_EDITOR_ACCESS_FIELDS = [
  'version',
  'subject_id',
  'company_id',
  'product',
  'resource_kind',
  'binding_id',
  'native_id',
  'generation_id',
  'authz_epoch',
  'audience',
  'scopes',
  'current_role',
  'technical_status',
  'access_entitled',
  'entitlement_kind',
] as const;
export type CompanyEditorAccess = Omit<
  CompanyAccess,
  'version' | 'subscription_entitled'
> & {
  version: 2;
  access_entitled: true;
  entitlement_kind: 'beta' | 'subscription';
};
/** V1 remains read-only. V2 is an explicit browser-only authority contract;
 * native applications must intersect it with their current native permissions. */
export function companyEditorAccess(
  value: unknown,
  binding?: CompanyBinding,
): CompanyEditorAccess | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== 15 ||
    COMPANY_EDITOR_ACCESS_FIELDS.some(
      (k) => !Object.prototype.hasOwnProperty.call(v, k),
    ) ||
    v.version !== 2 ||
    v.access_entitled !== true ||
    !['beta', 'subscription'].includes(v.entitlement_kind as string) ||
    !Array.isArray(v.scopes)
  )
    return null;
  if (typeof v.product !== 'string') return null;
  const read = v.product + ':read',
    write = v.product + ':write';
  if (
    !(
      (v.scopes.length === 1 && v.scopes[0] === read) ||
      (v.scopes.length === 2 && v.scopes[0] === read && v.scopes[1] === write)
    )
  )
    return null;
  const { access_entitled, entitlement_kind, ...common } = v;
  // Reuse only the structural V1 validator; this does not assert a subscription.
  const checked = companyAccess(
    { ...common, version: 1, scopes: [read], subscription_entitled: true },
    binding,
  );
  if (!checked) return null;
  const { subscription_entitled, ...fields } = checked;
  return {
    ...fields,
    version: 2,
    scopes: [...v.scopes],
    access_entitled: true,
    entitlement_kind: entitlement_kind as 'beta' | 'subscription',
  };
}
