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

## Running locally

```bash
cp packages/twenty-docker/.env.example packages/twenty-docker/.env
# set APP_SECRET, EXE_LICENSE_KEY, PG_DATABASE_PASSWORD, SERVER_URL
docker compose -f packages/twenty-docker/docker-compose.yml up -d
```
