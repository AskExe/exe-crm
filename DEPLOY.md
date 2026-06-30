# Exe CRM — Deploy Pipeline

## Docker Image

A single production image bundles the NestJS server and React frontend (served as static files from the server).

- **Registry:** `ghcr.io/askexe/exe-crm`
- **Dockerfile:** `packages/twenty-docker/twenty/Dockerfile` (target: `twenty`)
- **Build context:** repository root
- **Production tag source of truth:** `stack.release.json`

## Release workflow

| Workflow                                    | Trigger                                              | What it does                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/release-stack-image.yml` | tag `v*.*.*`, tag `stack-v*.*.*`, or manual dispatch | validates `stack.release.json`, builds the production image, and publishes to GHCR when `GHCR_TOKEN` is configured |

Production deployments must use the pinned image from `stack.release.json`; do **not** deploy `latest`.

## Stack update contract

`stack.release.json` declares:

- image: `ghcr.io/askexe/exe-crm:v0.9.3`
- image env var: `CRM_IMAGE_TAG`
- health/smoke checks
- migration command and rollback guidance

`packages/twenty-docker/docker-compose.yml` reads `CRM_IMAGE_TAG`, so exe-os stack updates can change the image without editing Compose.

## Health endpoints

- `/healthz` — readiness-style health check for server, database, and Redis.
- Worker container health validates Redis queue connectivity.

## Backup & Disaster Recovery

The `docker-compose.yml` includes a `db-backup` sidecar that runs `pg_dump` every 6 hours:

- **Backups stored in:** the `db-backups` Docker volume
- **Retention:** last 7 dumps (42 hours of coverage)
- **Format:** PostgreSQL custom format (`.dump`)

### Restoring from backup

```bash
# List available backups
docker compose -f packages/twenty-docker/docker-compose.yml \
  exec db-backup ls -lt /backups/

# Restore a specific backup (stops server first)
docker compose -f packages/twenty-docker/docker-compose.yml stop server worker
docker compose -f packages/twenty-docker/docker-compose.yml \
  exec db pg_restore -U postgres -d default --clean --if-exists \
  /backups/exe-crm_YYYYMMDD_HHMMSS.dump
docker compose -f packages/twenty-docker/docker-compose.yml start server worker
```

### External backup (recommended for production)

For production VPS deployments, also configure an external backup target (S3-compatible storage, rsync to secondary host, or VPS provider snapshots). The built-in sidecar protects against application-level data loss; external backups protect against host-level failures.

## Database Migration Safety

### Destructive operation gate

Dynamic workspace schema changes (DROP TABLE, DROP COLUMN, DROP TYPE) are blocked at runtime unless `ALLOW_DESTRUCTIVE_DB_OPS=true` is explicitly set. Production deployments must leave this disabled.

### Release migration checklist

Before applying a new CRM version to a customer VPS:

1. **Back up the database** — trigger an immediate `pg_dump` or VPS snapshot before upgrading. Do not rely solely on the 6-hour sidecar cycle.
2. **Review migrations are additive** — inspect new TypeORM migrations for DROP/ALTER/DELETE operations. Destructive `down` paths exist in the migration history; rolling back requires a database restore, not a reverse migration.
3. **Test on staging first** — run `docker compose up` against a copy of production data to verify migrations apply cleanly.
4. **Keep `ALLOW_DESTRUCTIVE_DB_OPS` disabled** — this env var gates dynamic schema manager operations. Only enable it temporarily for planned schema cleanup with explicit approval.
5. **Verify after upgrade** — hit `/healthz` and confirm server + worker + Redis are healthy.

### Rollback procedure

If a migration fails or causes data issues:

1. Stop server and worker containers
2. Restore from the pre-upgrade backup (see Backup & Disaster Recovery above)
3. Revert to the previous `CRM_IMAGE_TAG` in `.env`
4. Restart containers

## Gateway authentication (fresh install → gateway can auth)

The Exe Gateway authenticates to the CRM with a bearer token sent as
`Authorization: Bearer <token>`. There are two supported paths to provision it
on a fresh VPS. Pick one; both produce a token that goes into the gateway's
`CRM_API_TOKEN`.

### Path A — shared admin secret (simplest, recommended for HYGO)

1. Generate a strong random secret:
   ```bash
   openssl rand -hex 32
   ```
2. Set it as `EXE_CRM_ADMIN_TOKEN` in `packages/twenty-docker/.env` (CRM side).
3. Set the **same value** as `CRM_API_TOKEN` in the gateway's env.
4. Restart the CRM server container so `AdminTokenMiddleware` picks it up.

The middleware SHA-256-hashes the configured secret and timing-safe-compares
incoming tokens, then resolves the first (oldest) workspace — correct for the
single-tenant HYGO deployment. No CLI step is required.

### Path B — per-workspace API key (`workspace:generate-api-key` CLI)

The server image ships a CLI that mints a real per-workspace API key bound to
the Admin role. Run it inside the running `server` container:

```bash
# List workspaces' API keys (also confirms the workspace ID exists)
docker compose -f packages/twenty-docker/docker-compose.yml \
  exec server yarn command:prod workspace:generate-api-key \
  --workspace-id <WORKSPACE_ID> --list

# Generate a non-expiring key (omit --expires-in for no expiry)
docker compose -f packages/twenty-docker/docker-compose.yml \
  exec server yarn command:prod workspace:generate-api-key \
  --workspace-id <WORKSPACE_ID> --name "exe-gateway"

# Revoke a key by ID
docker compose -f packages/twenty-docker/docker-compose.yml \
  exec server yarn command:prod workspace:generate-api-key \
  --workspace-id <WORKSPACE_ID> --revoke <API_KEY_ID>
```

Command name: `workspace:generate-api-key` (run via `yarn command:prod`).
Flags: `-w/--workspace-id` (required), `-n/--name`, `-e/--expires-in <days>`
(omit for never-expiring), `-l/--list`, `-r/--revoke <apiKeyId>`.

On success the command prints the **raw bearer token to stdout exactly once**
(it is not recoverable afterward and is intentionally not written to the
structured logger). Copy that token and set it as the gateway's `CRM_API_TOKEN`.

> Single-tenant note: the admin-token path always targets the first workspace,
> so Path A needs no workspace ID. For Path B, find the workspace ID via the
> CRM (Settings → Workspace) or `SELECT id FROM core."workspace";`.

See CONTRACTS.md → "Optional — Gateway / Admin API auth" for the env contract.

## Running locally

```bash
cp packages/twenty-docker/.env.example packages/twenty-docker/.env
# set APP_SECRET, EXE_LICENSE_KEY, PG_DATABASE_PASSWORD, SERVER_URL
docker compose -f packages/twenty-docker/docker-compose.yml up -d
```
