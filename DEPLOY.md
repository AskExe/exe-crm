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

> **Stop the `db-backup` sidecar before restoring.** A destructive
> `pg_restore --clean --if-exists` drops and recreates objects. If the backup
> cron fires its scheduled `pg_dump` during that window it will capture a
> half-restored database as a "valid" dump and, because retention keeps only
> the last 7 dumps, prune an older *good* backup to make room. Always suspend
> the sidecar first, verify the restore, and resume backups only once the stack
> is consistent.

```bash
# 1. List available backups (while the sidecar is still running)
docker compose -f packages/twenty-docker/docker-compose.yml \
  exec db-backup ls -lt /backups/

# 2. Quiesce the app AND the backup sidecar so nothing writes mid-restore
docker compose -f packages/twenty-docker/docker-compose.yml stop server worker db-backup

# 3. Restore the chosen backup (destructive: drops & recreates objects)
docker compose -f packages/twenty-docker/docker-compose.yml \
  exec db pg_restore -U postgres -d default --clean --if-exists \
  /backups/exe-crm_YYYYMMDD_HHMMSS.dump

# 4. VERIFY the restore succeeded before bringing anything back up
#    (exit code 0, expected row counts, sanity-check key tables).
#    Do NOT resume backups until you are satisfied the data is correct —
#    resuming early lets the cron overwrite good dumps with a bad state.

# 5. Bring the app back online
docker compose -f packages/twenty-docker/docker-compose.yml start server worker

# 6. Only AFTER verification, resume the backup sidecar
docker compose -f packages/twenty-docker/docker-compose.yml start db-backup
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

## Running locally

```bash
cp packages/twenty-docker/.env.example packages/twenty-docker/.env
# set APP_SECRET, EXE_LICENSE_KEY, PG_DATABASE_PASSWORD, SERVER_URL
docker compose -f packages/twenty-docker/docker-compose.yml up -d
```
