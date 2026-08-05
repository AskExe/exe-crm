/**
 * Whether the static-secret "Admin Token" owner-impersonation login is enabled
 * for this deployment.
 *
 * Fail-closed policy (bug: admin-token server backdoor). Hiding the React tab
 * (`REACT_APP_ENABLE_ADMIN_TOKEN_LOGIN`) only removed the UI — the server still
 * accepted `POST /api/auth/admin-token` and the `Authorization: Bearer
 * <EXE_CRM_ADMIN_TOKEN>` middleware path. Both server paths are now gated here:
 *
 *  - MANAGED deployments (`EXE_ORG_ID` set) must NEVER expose a static-secret
 *    owner-impersonation backdoor: a single leaked/rotated-late secret would
 *    mint an OWNER session and bypass exe_perms entirely. Always disabled when
 *    managed, regardless of the flag.
 *  - Unmanaged deployments keep the break-glass path, but it is now OFF by
 *    default and must be explicitly opted into with
 *    `ENABLE_ADMIN_TOKEN_LOGIN=true`.
 *
 * `env` is injectable for testing.
 */
export const isAdminTokenLoginEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => env.ENABLE_ADMIN_TOKEN_LOGIN === 'true' && !env.EXE_ORG_ID;
