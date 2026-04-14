# Exe CRM — Deploy Pipeline

## Docker Image

A single production image bundles the NestJS server and React frontend (served
as static files from the server).

- **Registry:** `ghcr.io/askexe/exe-crm`
- **Dockerfile:** `packages/twenty-docker/twenty/Dockerfile` (target: `twenty`)
- **Build context:** repository root

### Tags

| Trigger | Tags applied |
|---------|-------------|
| Push to `main` | `latest`, `sha-<short>` |
| Tag push `v*` | `<version>`, `<major>.<minor>`, `latest`, `sha-<short>` |

## CI/CD Workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `cd-deploy-main.yaml` | Push to `main` | Build + push image to GHCR |
| `cd-deploy-tag.yaml` | Tag push `v*` | Build + push image to GHCR with version tags |
| `health-check.yaml` | Manual (`workflow_dispatch`) | Curl `/healthz` on `crm.askexe.com` |
| `ci-brand-drift.yaml` | Pull request | Detect "twenty" brand leaks |

> **SSH deploy is deferred.** The pipeline builds and pushes images only.
> When VPS credentials are available, add a deploy job that SSHes in and
> runs `docker pull && docker compose up -d`.

## Health Endpoint

- **Path:** `/healthz`
- **Controller:** `packages/twenty-server/src/engine/core-modules/health/controllers/health.controller.ts`
- **Method:** `GET`
- **Expected response:** `200 OK` with NestJS health check payload

The `health-check.yaml` workflow is disabled by default. Once `crm.askexe.com`
is live, uncomment the `schedule` trigger to enable automated checks every 6
hours.

## Pulling the Image

```bash
docker pull ghcr.io/askexe/exe-crm:latest
```

## Running Locally

```bash
# See packages/twenty-docker/docker-compose.yml for the full stack
docker compose -f packages/twenty-docker/docker-compose.yml up
```
