# Exe CRM — Contracts

Living reference for API contracts, environment variables, image conventions, and cross-repo dependencies.

## Server URL & Ports

| Service             | Internal port | Default host mapping | Configurable via   |
| ------------------- | ------------- | -------------------- | ------------------ |
| Server (HTTP + API) | 3000          | `127.0.0.1:3000`     | `CRM_HOST_PORT`    |
| Worker              | — (no port)   | —                    | —                  |
| PostgreSQL          | 5432          | not exposed          | `PG_DATABASE_PORT` |
| Redis               | 6379          | not exposed          | `REDIS_URL`        |

`SERVER_URL` must be set to the externally-reachable origin (e.g. `https://crm.askexe.com`).

## Docker Image Naming & Tagging

| Image                    | Registry                  | Tagging convention                                                                |
| ------------------------ | ------------------------- | --------------------------------------------------------------------------------- |
| `ghcr.io/askexe/exe-crm` | GitHub Container Registry | Stack release tags (`v0.9.3`, `v0.9.4`, …). **Never use `latest` in production.** |
| `postgres`               | Docker Hub                | Pin to `16.9-alpine` (or next minor).                                             |
| `redis`                  | Docker Hub                | Pin to `7-alpine`.                                                                |

The `CRM_IMAGE_TAG` env var in `.env` controls which exe-crm image version is pulled by `docker-compose.yml`. Default is `v0.9.3` and must match `stack.release.json` for customer stack updates.

## Environment Variables

### Required (server will not start without these)

| Variable               | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| `APP_SECRET`           | 256-bit secret for session signing. Generate: `openssl rand -base64 32` |
| `EXE_LICENSE_KEY`      | Exe CRM license key from <https://askexe.com>                           |
| `PG_DATABASE_PASSWORD` | PostgreSQL password (must be URL-safe or URL-encoded)                   |
| `REDIS_PASSWORD`       | Redis auth password. docker-compose starts Redis with `--requirepass` and builds `REDIS_URL` from it, so the stack refuses to boot ("Set REDIS_PASSWORD") until set. Generate: `openssl rand -hex 32`. |
| `CRM_IMAGE_TAG`        | Pinned Exe CRM image tag, e.g. `v0.9.3`.                                |

### Optional — Database

| Variable           | Default               | Description                                                |
| ------------------ | --------------------- | ---------------------------------------------------------- |
| `PG_DATABASE_URL`  | built from components | Full Postgres connection string (overrides component vars) |
| `PG_DATABASE_USER` | `postgres`            |                                                            |
| `PG_DATABASE_HOST` | `db`                  |                                                            |
| `PG_DATABASE_PORT` | `5432`                |                                                            |
| `PG_DATABASE_NAME` | `default`             |                                                            |

### Optional — Redis

| Variable         | Default              | Description                                                                                                                                  |
| ---------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `REDIS_PASSWORD` | —                    | **Required** for the bundled Redis (see above). Interpolated into the default `REDIS_URL` as `redis://:${REDIS_PASSWORD}@redis:6379`.        |
| `REDIS_URL`      | built from password  | Full Redis connection string. Set explicitly only to point at an external/managed Redis; when set it takes precedence over `REDIS_PASSWORD`. |

### Optional — Storage

| Variable                           | Default | Description            |
| ---------------------------------- | ------- | ---------------------- |
| `STORAGE_TYPE`                     | `local` | `local` or `s3`        |
| `STORAGE_S3_REGION`                | —       | S3 region              |
| `STORAGE_S3_NAME`                  | —       | S3 bucket name         |
| `STORAGE_S3_ENDPOINT`              | —       | S3-compatible endpoint |
| `STORAGE_S3_ACCESS_KEY_ID`         | —       |                        |
| `STORAGE_S3_SECRET_ACCESS_KEY`     | —       |                        |
| `STORAGE_S3_PRESIGNED_URL_ENABLED` | —       |                        |
| `STORAGE_S3_PRESIGNED_URL_BASE`    | —       |                        |

### Optional — Auth (GoTrue / Supabase)

| Variable              | Default         | Description                                 |
| --------------------- | --------------- | ------------------------------------------- |
| `GOTRUE_URL`          | —               | GoTrue endpoint for external JWT validation |
| `GOTRUE_JWT_ISSUER`   | —               |                                             |
| `GOTRUE_JWT_AUDIENCE` | `authenticated` |                                             |

### Optional — Gateway / Admin API auth

| Variable             | Default | Description                                                                                                                                                                                                 |
| -------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXE_CRM_ADMIN_TOKEN` | —       | Shared bearer secret for admin-scoped GraphQL/REST access (used by the Exe Gateway). When set, `AdminTokenMiddleware` authenticates `Authorization: Bearer <token>` requests against the first workspace. Generate: `openssl rand -hex 32`. |

**Gateway contract:** this value MUST equal the gateway's `CRM_API_TOKEN`
(see exe-gateway env). The gateway sends it as `Authorization: Bearer <token>`
on every CRM push; the middleware SHA-256-hashes and timing-safe-compares it,
then resolves the first workspace (oldest by `createdAt`) — correct for the
single-tenant HYGO deployment. If unset, admin-token auth is disabled and the
gateway cannot push contacts via the admin path.

Two ways to obtain a token the gateway can use:
1. **Shared secret (simplest):** set `EXE_CRM_ADMIN_TOKEN` to a random value and
   copy the same value into the gateway's `CRM_API_TOKEN`.
2. **Per-workspace API key:** run the `workspace:generate-api-key` CLI (see
   DEPLOY.md) and use the emitted bearer token as the gateway's `CRM_API_TOKEN`.

**Admin-token middleware behavior & limitations** (`AdminTokenMiddleware`):

- **Workspace resolution (single-tenant assumption).** On a successful token
  match the middleware resolves the workspace via
  `findOne({ where: {}, order: { createdAt: 'ASC' } })` — i.e. the **first /
  oldest** workspace by `createdAt`. There is intentionally **no** workspace
  selector on the admin path. This is correct for HYGO (one workspace per VPS)
  but means the admin token can only ever act on workspace #1; a multi-tenant
  deployment would need this path reworked to scope by an explicit workspace
  header/claim.
- **In-memory rate limiter (resets on restart).** Failed bearer attempts are
  throttled by a per-IP sliding-window limiter (10 attempts / 60s) held in a
  process-local `Map`. It is **not** shared across server/worker replicas and
  is **cleared on every container restart**, so an attacker who can trigger or
  time restarts could reset the window. This is acceptable for HYGO because the
  CRM sits behind nginx, which provides the durable IP-based rate limiting
  (see [Rate Limiting](#rate-limiting) below). Treat the in-memory limiter as
  defense-in-depth, not the primary control.

### Optional — Worker / Migration

| Variable                         | Default | Description                                       |
| -------------------------------- | ------- | ------------------------------------------------- |
| `DISABLE_DB_MIGRATIONS`          | —       | Set `true` on workers (server handles migrations) |
| `DISABLE_CRON_JOBS_REGISTRATION` | —       | Set `true` on workers                             |

### Optional — Backups

| Variable         | Default | Description                                                                                                                                                                                 |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXE_BACKUP_KEY` | —       | GPG symmetric passphrase for the `db-backup` service (pg_dump every 6h). When set, dumps are AES256-encrypted (`*.dump.gpg`); when unset, dumps are written **unencrypted** and a warning is logged. Required to restore encrypted dumps — store it off-VPS. Generate: `openssl rand -base64 32`. |

### Optional — Logging

| Variable        | Default   | Description                                                                                   |
| --------------- | --------- | --------------------------------------------------------------------------------------------- |
| `LOGGER_DRIVER` | `CONSOLE` | `CONSOLE` (NestJS default) or `PINO` (structured JSON in production, pretty-print in dev)     |
| `LOG_LEVELS`    | `log,error,warn` | Comma-separated NestJS log levels: `log`, `error`, `warn`, `debug`, `verbose`           |

### Optional — Monitoring

| Variable                    | Default | Description                                                          |
| --------------------------- | ------- | -------------------------------------------------------------------- |
| `SENTRY_DSN`                | —       | Sentry DSN for error tracking                                        |
| `EXCEPTION_HANDLER_DRIVER`  | —       | Set to `SENTRY` to enable Sentry integration                        |
| `SENTRY_ENVIRONMENT`        | —       | Sentry environment label (e.g. `production`)                         |

### Optional — Analytics (ClickHouse)

| Variable         | Default | Description                                    |
| ---------------- | ------- | ---------------------------------------------- |
| `CLICKHOUSE_URL` | —       | ClickHouse connection string for analytics     |

### Safety

| Variable                   | Default         | Description                                                                                                     |
| -------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------- |
| `ALLOW_DESTRUCTIVE_DB_OPS` | `false` (unset) | Must be explicitly set to `true` to permit `DROP TABLE` / `DROP COLUMN` operations at the schema-manager level. |

## Rate Limiting

The application includes a custom token-bucket throttler (`ThrottlerService`) used by specific modules (AI chat, workflow execution, logic functions). Auth endpoints are protected by an optional captcha guard (`CaptchaGuard`).

**For production deployments**, add reverse proxy rate limiting:

```nginx
# Example nginx rate limiting for auth endpoints
limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=api:10m rate=100r/m;

server {
    location /api {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
    }
    location ~ ^/api/auth {
        limit_req zone=auth burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
    }
}
```

Without a reverse proxy, the application has no global IP-based rate limiting. This is a known gap documented for remediation.

## MCP Integration Points

Exe CRM does not currently expose its own MCP server. It is consumed as a standalone service reached via `SERVER_URL`. Future MCP tooling (if added) will be documented here.

## External Service Dependencies

| Service                  | Used by                        | Purpose                                       | Required? |
| ------------------------ | ------------------------------ | --------------------------------------------- | --------- |
| `twenty-companies.com`   | `create-company.service.ts`    | Company enrichment (logo, domain lookup)       | No — gracefully degrades if unavailable |
| `fonts.googleapis.com`   | Branding block in `index.html` | Custom font loading for white-label branding   | No — falls back to system fonts |

> **Note:** `twenty-companies.com` is an upstream (Twenty) service. It is not Exe-controlled. Customer data (company names) is sent to this service for enrichment. If this conflicts with data sovereignty requirements, disable company enrichment or replace the `TWENTY_COMPANIES_BASE_URL` constant in `packages/twenty-shared/src/constants/TwentyCompaniesBaseUrl.ts`.

## Stack Contract Compliance

### GoTrue Security Policy

When `GOTRUE_URL` is configured for external auth:
- Signup endpoint MUST be disabled on the GoTrue instance
- `MAILER_AUTOCONFIRM` must be set to `false` (users confirm email)
- JWT audience MUST match `GOTRUE_JWT_AUDIENCE`

### UI Section States

All major UI sections (tables, forms, sidebars, panels) must implement:
- **loading** — data is being fetched
- **ready** — data loaded and displayed
- **empty** — no data exists (distinguish from error)
- **error** — fetch/operation failed with human-readable message and retry affordance
- **degraded** — partial function available, names what is unavailable

CRM tables/API contracts must fail with explicit degraded/error states, not skeleton forever.

### Progress Events

Long-running operations (workflow execution, data imports) must emit events with:

| Field | Required | Description |
|---|---|---|
| `operationId` | Yes | Unique ID for the operation |
| `phase` | Yes | Current phase name |
| `label` | Yes | Human-readable description |
| `status` | Yes | queued / running / blocked / degraded / succeeded / failed / cancelled |
| `updatedAt` | Yes | ISO timestamp |
| `current` / `total` | Optional | Only when accurately measurable |

Fake, timer-only, or cosmetic progress is forbidden.

### Error Forwarding

All 5xx backend errors are forwarded to exe-monitor-hub via `ErrorForwardingFilter` and `ErrorForwardingService`.
Configured by `MONITOR_ERROR_URL` and `ERROR_REPORTING_ENABLED` (default: `true`).
Fire-and-forget with 5-second timeout.

## Cross-Repo Dependencies

| Dependency | Relationship                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **exe-os** | Orchestration layer. Launches exe-crm via Docker Compose. Reads `SERVER_URL` to proxy API calls.                                                 |
| **exe-db** | Optional shared PostgreSQL instance. When using exe-db, set `PG_DATABASE_URL` to point at the exe-db host instead of the bundled `db` container. |
| **exe-monitor-hub** | Receives error/degradation alerts via error-forwarding service.                                                                         |
