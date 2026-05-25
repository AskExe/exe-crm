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

## Running locally

```bash
cp packages/twenty-docker/.env.example packages/twenty-docker/.env
# set APP_SECRET, EXE_LICENSE_KEY, PG_DATABASE_PASSWORD, SERVER_URL
docker compose -f packages/twenty-docker/docker-compose.yml up -d
```
