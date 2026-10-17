# Staged company CRM read adapter

This default-off source foundation is limited to native REST reads. It does not open company session issuance, native UI SSO, public onboarding, or production tenant access. The current Broker still refuses company-session issuance. Private synthetic authority fixtures may exercise the adapter; they are not technical acceptance or commercial entitlement evidence.

`CRM_COMPANY_MODE` accepts only `true` or `false` (default `false`). Legacy behavior, native credentials, workspace provisioning and installation licensing remain unchanged when off. With it enabled, the entire public browser/API surface is closed except GET `/rest/people` and `/rest/companies`, optionally followed by a canonical native record UUID. `depth=0` is mandatory; `limit` is also mandatory and is 1..100. Other query names, relation expansion, writes, metadata/GraphQL, signup, imports/exports, files, AI/inference, MCP, SSE and WebSockets are denied. There is no native JWT or local API-key fallback.

## Fixed operator configuration

The operator must supply canonical company, existing native workspace, binding and generation UUIDs using `CRM_COMPANY_ID`, `CRM_COMPANY_WORKSPACE_ID`, `CRM_COMPANY_BINDING_ID` and `CRM_COMPANY_GENERATION_ID`; exact existing `CRM_COMPANY_NATIVE_SCHEMA` (schema drift denies); fixed registered `CRM_COMPANY_CLIENT_ID` and `CRM_COMPANY_AUDIENCE`; and exact canonical HTTPS `CRM_COMPANY_ORIGIN`. Private bare HTTP origins `CRM_COMPANY_BROKER_URL` and `CRM_COMPANY_AUTHORITY_URL` refer only to dedicated private services, never browser destinations. Native backends must have no public ports and must sit behind the reviewed tenant transport edge; this adapter does not replace that boundary.

`CRM_COMPANY_CLIENT_SECRET_FILE` and `CRM_COMPANY_BINDINGS_FILE` must be regular non-symlink mode0600 files owned by the native process UID. The client secret contains 32..128 safe opaque characters. The bounded bindings file (maximum64KiB/100 entries) is an exact JSON array of `{subject_id,user_id,user_workspace_id,workspace_member_id}` canonical UUID records; no emails, roles, caller selectors or automatic user creation. Subject and native user must be unique. `CRM_COMPANY_BINDINGS_SHA256` binds the exact file bytes to the deployment. The process loads it once; changed mappings require a separately reviewed deployment/generation and restart. Operator onboarding, secure backup and lifecycle of this file remain separate acceptance gates.

The installation must already contain the exact active native workspace and user/member/role linkage. Bootstrap and activation are operator steps performed with company mode off. Enabled mode requires `IS_MULTIWORKSPACE_ENABLED=false`, `IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS=true` and `DISABLE_CRON_JOBS_REGISTRATION=true`. Native workers, job enqueue/cron execution and unreviewed read hooks refuse enabled mode. Do not attach native workers to its Redis queues.

Do not supply parent identity endpoints, GoTrue signing/admin credentials, installation keys or static native admin tokens in enabled mode. No parent credential is needed. The adapter never contacts legacy cloud license activation while enabled, grants no extra enterprise feature flag, and authorizes the finite read policy only after current accepted technical authority and a separate subscription predicate.

## Current authority and native ACL intersection

Only the product's own host-only opaque `__Host-exe_crm_session=exs_…` cookie or exact business-key `Bearer exk_…` is accepted, never both. Legacy parent cookies are ignored rather than promoted. Token format is not authority. Every native middleware/guard read makes a fresh fixed-client private introspection call: Basic registered client authentication and exact `{session_token}` to Broker `/internal/session-broker/introspect`, or `{api_key}` to Authority `/internal/company-authority/key-introspect`. No actor/company/workspace/audience can be selected by the caller.

The exact version1 CompanyIntrospectionV1 envelope must identify this fixed company, product `crm`, resource kind `crm-workspace`, native workspace, binding, generation and audience; positive canonical authorization epoch; current owner/member; exactly `crm:read`; technical status `accepted`; and independently derived `subscription_entitled=true`. Missing, foreign, revoked, expired, unsupported, malformed or unavailable authority denies. No accepted registry flag or client boolean can mint an envelope.

After introspection, narrowly fixed TypeORM identity queries read the mapped current native user, userWorkspace, workspaceMember and explicit RoleTarget/Role. Disabled/deleted users, missing/revoked native membership, inactive/suspended workspace and role mismatch deny. The mapping never assigns a role or promotes a Core owner to native admin. The native row predicate helper is always enforced in company mode even if its legacy feature enablement flag is off; this adds a restriction and grants no feature. Company-mode permission/identity-role/metadata reads compute directly from existing native repository-backed providers, without shared cache or promise memoization. Provider failure denies without a cached fallback. The unchanged native REST/TwentyORM runs under the genuine user auth context. Business records never use raw SQL, system context, native API-key context or permission bypass.

## Outstanding gates

Actual native two-company runtime/ACL proof, native browser UI and company handoff, independently accepted signed deployment/readiness, current commercial authority, scoped writes/import/backup, realtime per-message authorization, durable job authorization, and measured 100-user capacity remain separate work. Optional isolated exe-os memory is not a required identity, license or workspace authority.

## Owned backend fixture

`tests/company-runtime/build-company-read-fixture.mjs <exact-runtime-SHA> <private-manifest-path>` archives only that Git source and uses its pinned native server build, immutable-lock common dependency install, actual native compilation, entrypoint and UID1000. This explicitly labelled backend-only fixture retains development tooling and omits production dependency focus to avoid another dependency download. It excludes the closed frontend bundle. It uses a temporary private Docker CLI configuration and the existing local Docker Desktop socket; it does not edit production Dockerfiles or replace release manifests. The owned build stops below20GiB host free space. Before Docker runs, the builder rejects committed symlinks and submodules; resolves the commit without Git replace refs; and compares every extracted regular file and mode with the commit blob. Missing/export-substituted, altered or untracked files fail closed. Only the digested derived fixture Dockerfile may be added. The manifest records source tree/archive, native and derived Dockerfile, builder and source-guard SHA256 digests; source tree/archive/recipe are also image labels. A build-time check refuses any dependency installation that changes the committed Yarn lock. The native fixture checks the loaded critical dependency versions and lock digest before starting native servers.

`node tests/company-runtime/native-company-read.integration.mjs <private-manifest-path>` requires the exact runtime source label pinned in the fixture. It bootstraps two independent native databases/workspaces through the actual native operator flow while mode is off, then restarts compiled servers under fixed company configuration. Private synthetic authority supplies only fixture envelopes and hashed own credentials. Native records are read through shipped REST/TwentyORM under the operator-bound real user; fixture SQL changes native permission/identity state for denial tests and never supplies a business-record response.

The fixture covers current/foreign authority, malformed envelope and provider failure, legacy/native credential denial, explicit current native object/field/row ACL, downgrade and membership revocation while authority is blocked, closed unknown/write/realtime routes and worker refusal. It is a backend authorization test design until a successful exact-source run is recorded. A dev-dependency/server-only artifact/run is not a full production dependency/security surface or image admission, browser UI/SSO, current company issuance, commercial acceptance, or100-user capacity proof. Full release-image build and independent technical admission remain required.

Source-only preflight regression command: `node --test tests/company-runtime/company-read-source.test.mjs`. These checks use disposable local Git archives and never start Docker. They prove dirty/untracked checkout exclusion, committed/extracted symlink and submodule refusal, replacement-ref resistance, export omission/substitution rejection, context content/mode/extra-file denial and strict fixture recipe bounds. They do not prove compiled native runtime authorization.

## Direct REST freshness source guard

Hosted GET dispatch for the existing bounded people/companies routes now uses
CompanyRestReadService. It derives a fresh fixed native user context, rebuilds
only a server-owned depth-0 DTO, installs the same owned native read lease, waits
for terminal SQL/rollback/release, and reauthorizes current central/native
permissions before bounded JSON serialization. It has immutable monotonic and wall deadlines of at most 9 seconds, propagates
abort signals, permits at most 8 active reads and 30 requests per credential per
minute across 256 rate keys, and bounds results to 256 KiB. Direct legacy credentials and ambiguous headers remain denied.
Off-mode REST preserves its existing dispatcher. MCP enablement remains independent.

Controlled company reads fail closed if native row predicates are not enabled;
no row policy is created or replaced. Both REST and MCP use this same native
select-builder check. The snapshot read control admits only fixed people/companies,
canonical optional record ID and bounded limit, not an arbitrary caller runner.

The complete-source controlled test exercises service/controller/lease/select
classes, with private authority and TypeORM/ACL dependency boundaries controlled.
It does not prove actual native SQL field/row policies, two-company isolation,
GoTrue browser handoff, DB timeout/cancellation or deployability. Read leases await
active SQL and rely on PostgreSQL statement_timeout rather than immediate signal
cancellation. The fixed isolated-process teardown policy remains unchanged.
Native SDK/Jest/Nx/typecheck and actual PG/browser proofs remain held. No write,
import, GraphQL, file, search, job, UI or new scope is enabled.


### Native permission supply in the reviewed source

In the reviewed `e0b47e5` source, `GlobalWorkspaceDataSource.permissionsPerRoleId`
is a getter for the current ORM AsyncLocalStorage context, rather than a shared
stored permission map. `GlobalWorkspaceOrmManager.loadWorkspaceContext` calls
`WorkspaceCacheService.getOrRecompute`; company mode recomputes role permissions,
user-role maps, object/field metadata and row-predicate maps through their native
providers before the normal cache or promise memoizer. The role provider reads
current native Role relations and ObjectMetadata through TypeORM repositories.
`WorkspaceEntityManager.getRepository` derives native object/field permissions
from that request's role map and passes them, the user auth context and existing
permission options to `WorkspaceRepository` and its select builder.

REST FindMany reaches this context through `CommonBaseQueryRunnerService`, then
`CommonFindManyQueryRunnerService.run` installs the owned read lease and supplies
its runner to the permission-aware query builder. The fixed count uses its clone.
The REST service waits for the lease to complete rollback and release before its
second current-authority/fingerprint check. Older `WorkspaceDataSource` references
do not establish a stale shared map in this admitted GlobalWorkspaceDataSource
path. No global permission state is changed by this source guard.

These separate native reads and post-read comparison are not a single database
policy snapshot or proof against every concurrent permission change and reversal.
The legacy feature-flag map remains outside the fresh permission keys; a false
row-predicate enablement value now denies controlled company reads, while a true
value runs the native predicates. This conservative check creates no policies and
does not revoke explicit native company sharing. Actual TypeORM/PostgreSQL ACL
and concurrency evidence is still required.

## Staged company browser producer

`CRM_COMPANY_BROWSER_ENABLED=false` is the default. Enabling requires existing
complete company configuration, `CRM_COMPANY_AUTH_ORIGIN=https://auth.<platform>`,
and a distinct native-owned 0600 regular single-link `CRM_COMPANY_FLOW_SECRET_FILE`.
Partial config refuses before listening. Auth registration must exactly match the
fixed client and `https://crm.<company>/company-session/callback`; no caller can
select workspace, company, subject, upstream or callback.

The company-mode middleware admits only fixed start/callback/status GET and
same-origin POST logout. Start signs a 600-second host flow binding registration,
native workspace, generation, audience, callback and Auth origin; state and S256
verifier each have 256 random bits. Callback redeems the one-use central code via
fixed private Basic client, then uses the existing actual CompanyAuthService
current session path and operator-bound native User/UserWorkspace/workspaceMember
and role lookup. No email matching, provisioning, native session, role change,
legacy JWT or Core-owner-to-native-admin mapping occurs. Success publishes only
Secure HttpOnly SameSite=Lax host session (at most 900 seconds), clears own flow,
and redirects to staged status. Status is not a CRM UI substitute or native write
admission. Native app source and off-mode routes remain unchanged.

Provider calls have three-second abort bounds (existing shared introspection has
five seconds); response bodies are bounded, redirects refused, 400/401/503 remain
explicit. Each producer request has immutable nine-second monotonic/wall budgets,
abort propagation and no late positive serialization, at most eight active and
120 requests per company process per minute. Logout is audience-local, requires
exact Origin and only clears own cookies after exact verified revocation; failure
preserves cookies. Flow-only/duplicate/legacy cookies do not authenticate. No
native transaction spans a provider call. A signal does not terminate an active
native TypeORM query; native SQL/watchdog and concurrent role linearization are
still unproved, not silently claimed.

The full-module source fixture uses controlled Nest/TypeORM/entity conversion,
repository/provider boundaries and native request/response objects. It proves
source dispatch/control behavior only. Native Nest/Jest/Nx/typecheck, actual
GoTrue/Core/company A/B/ORM/browser redemption, full UI, native object/field/row
ACLs, write admission and commit semantics remain required before opening access.
Company session central issuance and public key mint remain separately gated.

The staged authenticated GET status destination also accepts same-site/cross-site
redirect-chain metadata only when Sec-Fetch-Mode is explicitly `navigate` and
Sec-Fetch-Dest explicitly `document`. Fetch Metadata considers the complete
redirect URL list ([W3C redirect rules](https://www.w3.org/TR/fetch-metadata/#redirects)),
so Auth→callback→status may retain that site classification.
Exact own Host and Origin rules remain; status still requires its own session and
fresh central/native checks. Missing session, flow-only identity, foreign Origin,
cross-site fetch/iframe or absent navigation metadata denies. No exception applies
to logout or native business APIs. Controlled callback→status assertions exercise
this protocol; they are not actual browser acceptance evidence.
