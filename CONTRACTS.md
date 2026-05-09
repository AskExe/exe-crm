# Exe CRM — Contracts

Living reference for API contracts, environment variables, image conventions, and cross-repo dependencies.

## Server URL & Ports

| Service | Internal port | Default host mapping | Configurable via |
|---------|--------------|----------------------|------------------|
| Server (HTTP + API) | 3000 | `127.0.0.1:3000` | `CRM_HOST_PORT` |
| Worker | — (no port) | — | — |
| PostgreSQL | 5432 | not exposed | `PG_DATABASE_PORT` |
| Redis | 6379 | not exposed | `REDIS_URL` |

`SERVER_URL` must be set to the externally-reachable origin (e.g. `https://crm.askexe.com`).

## Docker Image Naming & Tagging

| Image | Registry | Tagging convention |
|-------|----------|--------------------|
| `ghcr.io/askexe/exe-crm` | GitHub Container Registry | SemVer tags (`2.2.0`, `2.1.1`, …). **Never use `latest` in production.** |
| `postgres` | Docker Hub | Pin to `16.9-alpine` (or next minor). |
| `redis` | Docker Hub | Pin to `7-alpine`. |

The `TAG` env var in `.env` controls which exe-crm image version is pulled by `docker-compose.yml`. Default is `2.2.0`.

## Environment Variables

### Required (server will not start without these)

| Variable | Description |
|----------|-------------|
| `APP_SECRET` | 256-bit secret for session signing. Generate: `openssl rand -base64 32` |
| `EXE_LICENSE_KEY` | Exe CRM license key from <https://askexe.com> |
| `PG_DATABASE_PASSWORD` | PostgreSQL password (must be URL-safe or URL-encoded) |

### Optional — Database

| Variable | Default | Description |
|----------|---------|-------------|
| `PG_DATABASE_URL` | built from components | Full Postgres connection string (overrides component vars) |
| `PG_DATABASE_USER` | `postgres` | |
| `PG_DATABASE_HOST` | `db` | |
| `PG_DATABASE_PORT` | `5432` | |
| `PG_DATABASE_NAME` | `default` | |

### Optional — Redis

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |

### Optional — Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_TYPE` | `local` | `local` or `s3` |
| `STORAGE_S3_REGION` | — | S3 region |
| `STORAGE_S3_NAME` | — | S3 bucket name |
| `STORAGE_S3_ENDPOINT` | — | S3-compatible endpoint |
| `STORAGE_S3_ACCESS_KEY_ID` | — | |
| `STORAGE_S3_SECRET_ACCESS_KEY` | — | |
| `STORAGE_S3_PRESIGNED_URL_ENABLED` | — | |
| `STORAGE_S3_PRESIGNED_URL_BASE` | — | |

### Optional — Auth (GoTrue / Supabase)

| Variable | Default | Description |
|----------|---------|-------------|
| `GOTRUE_URL` | — | GoTrue endpoint for external JWT validation |
| `GOTRUE_JWT_ISSUER` | — | |
| `GOTRUE_JWT_AUDIENCE` | `authenticated` | |

### Optional — Worker / Migration

| Variable | Default | Description |
|----------|---------|-------------|
| `DISABLE_DB_MIGRATIONS` | — | Set `true` on workers (server handles migrations) |
| `DISABLE_CRON_JOBS_REGISTRATION` | — | Set `true` on workers |

### Safety

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOW_DESTRUCTIVE_DB_OPS` | `false` (unset) | Must be explicitly set to `true` to permit `DROP TABLE` / `DROP COLUMN` operations at the schema-manager level. |

## MCP Integration Points

Exe CRM does not currently expose its own MCP server. It is consumed as a standalone service reached via `SERVER_URL`. Future MCP tooling (if added) will be documented here.

## Cross-Repo Dependencies

| Dependency | Relationship |
|------------|-------------|
| **exe-os** | Orchestration layer. Launches exe-crm via Docker Compose. Reads `SERVER_URL` to proxy API calls. |
| **exe-db** | Optional shared PostgreSQL instance. When using exe-db, set `PG_DATABASE_URL` to point at the exe-db host instead of the bundled `db` container. |
