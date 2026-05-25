# exe-crm audit remediation summary — 2026-05-25

## Scope
Fixed the RED blockers from `exe/output/exe-crm-comprehensive-repo-audit-2026-05-25.md`:
- Axios/Yarn lockfile integrity
- TypeORM 0.3.30 compatibility/typecheck failures
- Jest/minimatch/file-type tooling failures
- AskExe/Exe CRM branding test drift
- Queue duplicate-work/idempotency risk for BullMQ producers
- Messaging cron SQL interpolation
- High-severity production dependency audit findings

## Changes made
- Regenerated `yarn.lock` so `axios@1.16.1` resolves under the existing root resolution.
- Updated high-severity vulnerable packages/resolutions:
  - `js-cookie` to `3.0.7`
  - `path-to-regexp` to `8.4.2`
  - `@opentelemetry/auto-instrumentations-node` to `0.76.0`
  - `@opentelemetry/sdk-node` to `0.218.0`
  - `@opentelemetry/exporter-prometheus` to `0.218.0`
- Removed the root `minimatch` override so Jest `test-exclude` resolves its compatible callable minimatch.
- Fixed `twenty-server` Jest config by removing unsupported `silent` and mapping `file-type` to the actual root package source path.
- Made workspace TypeORM wrappers compatible with TypeORM 0.3.30 `UpdateOptions` signatures.
- Fixed Node 24 crypto typing for GoTrue JWK verification and Axios content-type narrowing.
- Hardened BullMQ idempotent enqueueing: `options.id` is now a stable job ID and existing jobs are skipped across active/waiting/delayed states.
- Added idempotency keys to messaging list-fetch/import/relaunch-failed cron enqueue calls.
- Parameterized messaging cron SQL values and isolated schema identifier quoting, including the remaining relaunch-failed-message-channels cron.
- Updated AskExe/Exe CRM branding expectations in affected tests.

## Verification
PASS:
- `npx nx typecheck twenty-server`
- `npx nx typecheck twenty-front`
- `npx nx test twenty-server --runInBand --skip-nx-cache`
  - 489 passed / 2 skipped suites
  - 4355 passed / 10 skipped tests
- `npx nx build twenty-shared`
- `npx nx build twenty-server`
- `npx nx build twenty-front`
- `yarn npm audit --all --environment production --severity high --json`
  - exits 0 with no high-severity production advisories
- `npx prettier --check` on changed TS/JS/JSON files

Known environment note:
- `yarn install --immutable --mode=skip-build` links dependencies, then fails repository post-install validation because this shell is Node `v22.20.0` while the repo requires `^24.5.0`. This is an environment/runtime mismatch, not a lockfile resolution failure. The prior Axios lockfile failure is fixed, and dependency versions in local `node_modules` now reflect the updated lockfile.

## Commits
- `9e3a181005` — initial audit blocker remediation.
- Follow-up commit — closes the remaining relaunch-failed-message-channels SQL interpolation and idempotency gap. Pre-existing local `.codex/config.toml` remains intentionally excluded.
