# Exe CRM

Exe CRM is AskExe's self-hosted CRM service for customer-owned contacts, companies, opportunities, activities, files, workflows, and integrations. It runs inside the Exe OS customer stack as the `ghcr.io/askexe/exe-crm` image and is backed by customer-controlled Postgres, Redis, and optional S3-compatible storage.

Exe CRM is an AGPLv3 fork of [Twenty](https://github.com/twentyhq/twenty). Keep upstream attribution intact; see [NOTICE](./NOTICE), [LICENSE](./LICENSE), and [UPSTREAM.md](./UPSTREAM.md).

## Architecture and data flow

```text
Browser / operators
  -> Exe CRM server (NestJS + GraphQL/REST + static React frontend, port 3000)
  -> Postgres core schema + per-workspace schemas
  -> Redis queues/cache
  -> worker container for background jobs, workflows, sync, mail/calendar jobs

External systems
  -> exe-gateway adapters / curated routing
  -> CRM admin API or workspace API
  -> workspace_<base36(workspace_uuid)>.person / .company / other CRM objects
```

Important details:

- The production image bundles the React frontend and NestJS server; the worker uses the same image with `yarn worker:prod`.
- Postgres is multi-schema: workspace tables live in `workspace_<base36(workspace_uuid)>`, with singular table names such as `person` and `company`. See [docs/SCHEMA-CONTRACT.md](./docs/SCHEMA-CONTRACT.md).
- Exe Gateway can authenticate either with `EXE_CRM_ADMIN_TOKEN` / `CRM_API_TOKEN` shared secret or a generated per-workspace API key. See [DEPLOY.md](./DEPLOY.md#gateway-authentication-fresh-install--gateway-can-auth).
- CRM does not expose an MCP server today; other services call it over HTTP/API using `SERVER_URL`.

## Key directories

| Path | Purpose |
| --- | --- |
| `packages/twenty-front` | React/Vite CRM frontend |
| `packages/twenty-server` | NestJS API, GraphQL, TypeORM, workers, migrations |
| `packages/twenty-shared` | Shared types, constants, utilities |
| `packages/twenty-ui` | Shared UI component library |
| `packages/twenty-docker` | Production/dev Compose files, Dockerfile, install scripts |
| `packages/twenty-e2e-testing` | Playwright E2E tests |
| `docs/SCHEMA-CONTRACT.md` | External DB/schema contract for integrations |
| `CONTRACTS.md` | Env vars, API/deployment contracts, security notes |
| `DEPLOY.md` | Stack image, backup, migration, rollback, gateway auth runbook |
| `stack.release.json` | Current release image, digest, health checks, stack contract |

## Local development

Use Yarn 4 and Node 22+.

```bash
# Install dependencies
yarn install

# One-time/idempotent local setup: starts Postgres + Redis, creates DBs, copies env files
bash packages/twenty-utils/setup-dev-env.sh

# Start frontend + server + worker
yarn start
```

Useful targeted commands:

```bash
npx nx start twenty-front
npx nx start twenty-server
npx nx run twenty-server:worker

# Infrastructure only, if you do not use setup-dev-env.sh
docker compose -f packages/twenty-docker/docker-compose.dev.yml up -d
```

For source development, prefer the setup script. For a production-like local container run:

```bash
cp packages/twenty-docker/.env.example packages/twenty-docker/.env
# Edit required secrets/env first; do not commit .env.
docker compose -f packages/twenty-docker/docker-compose.yml up -d
curl --fail http://127.0.0.1:3000/healthz
```

## Environment variables

Canonical env documentation lives in [CONTRACTS.md](./CONTRACTS.md) and `packages/twenty-docker/.env.example`.

Required for Compose/stack boot:

| Variable | Notes |
| --- | --- |
| `CRM_IMAGE_TAG` | Must match the pinned release, currently `v0.9.51`; do not use `latest`. |
| `SERVER_URL` | Public origin, e.g. `https://crm.example.com`. |
| `APP_SECRET` | Session/app secret; generate with `openssl rand -base64 32`. |
| `EXE_LICENSE_KEY` | Customer license key. |
| `PG_DATABASE_PASSWORD` or `PG_DATABASE_URL` | Postgres credentials/connection string. |
| `REDIS_PASSWORD` or `REDIS_URL` | Redis auth/connection string. |
| `EXE_BACKUP_KEY` | Required by the backup sidecar; stores encrypted `.dump.gpg` backups. Keep off-VPS too. |

Common optional vars: `EXE_CRM_ADMIN_TOKEN`, `FRONTEND_URL`, `STORAGE_TYPE`, `STORAGE_S3_*`, `GOTRUE_*`, Google/Microsoft auth and calendar vars, SMTP email vars, `SENTRY_DSN`, `EXCEPTION_HANDLER_DRIVER`, `LOGGER_DRIVER`, `LOG_LEVELS`, `CLICKHOUSE_URL`, `ALLOW_DESTRUCTIVE_DB_OPS`.

## Build, test, and quality gates

```bash
# Build shared first when doing package builds
npx nx build twenty-shared
npx nx build twenty-front
npx nx build twenty-server

# Typecheck
npx nx typecheck twenty-front
npx nx typecheck twenty-server

# Fast lint on changed code
npx nx lint:diff-with-main twenty-front
npx nx lint:diff-with-main twenty-server

# Tests
npx nx test twenty-front
npx nx test twenty-server
npx nx run twenty-server:test:integration:with-db-reset
npx nx run twenty-e2e-testing:test
```

For a single test, run Jest directly with the package config, for example:

```bash
npx jest path/to/file.test.ts --config=packages/twenty-server/jest.config.mjs
```

## Deployment notes

- Production image: `ghcr.io/askexe/exe-crm:v0.9.51@sha256:73864ce14aaac06b73d67100bbf88e669fd13c7da39edd9644107037211559b7` from [stack.release.json](./stack.release.json).
- Release workflow: `.github/workflows/release-stack-image.yml` requires green CI for the exact commit, builds on the self-hosted runner, scans with Trivy, and verifies the pushed digest matches `stack.release.json`.
- Compose: `packages/twenty-docker/docker-compose.yml` starts `server`, `worker`, `db`, `redis`, and `db-backup`; services include healthchecks and resource limits.
- Health: server readiness is `GET /healthz`; worker health checks Redis queue connectivity.
- Migrations: the server entrypoint runs setup/migrations automatically. Workers set `DISABLE_DB_MIGRATIONS=true` and `DISABLE_CRON_JOBS_REGISTRATION=true`.
- Backup/restore: `db-backup` runs encrypted `pg_dump` every 6 hours and retains the last 7 dumps. Stop `server`, `worker`, and `db-backup` before destructive restore. See [DEPLOY.md](./DEPLOY.md#backup--disaster-recovery).
- Rollback: restore the pre-upgrade database backup, set the previous `CRM_IMAGE_TAG`, then restart.

## Operational and security gotchas

- Never commit secrets, `.env`, customer data, or license keys.
- Never deploy `latest`; use the digest-pinned release image from `stack.release.json`.
- Customer data must remain in customer-owned Postgres/storage volumes. Do not run `docker compose down -v` or remove volumes in production.
- Leave `ALLOW_DESTRUCTIVE_DB_OPS` unset/false in production unless explicitly approved for a planned cleanup.
- Reverse-proxy TLS and rate limiting are expected in production; the app does not provide full global IP rate limiting by itself.
- `EXE_CRM_ADMIN_TOKEN` targets the first/oldest workspace and assumes single-tenant VPS deployments.
- External enrichment may call `twenty-companies.com` with company names/domains; disable/replace it if that violates data-sovereignty requirements.
- Follow the repo style: no secrets, preserve auth middleware, no `require()` in ESM runtime code, no hardcoded employee/customer names, and do not rewrite committed migrations.
