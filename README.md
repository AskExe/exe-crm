# Exe CRM

Exe CRM is AskExe's self-hosted CRM service for customer-owned business data. It is designed to run inside the Exe OS stack on a customer VPS, backed by Postgres/Redis and shipped as a pinned GHCR image.

Exe CRM is based on [Twenty](https://github.com/twentyhq/twenty), originally created by Twenty.inc, and remains licensed under AGPLv3. See [NOTICE](./NOTICE) for attribution and AskExe modifications.

## Production image

- Registry: `ghcr.io/askexe/exe-crm`
- Stack release manifest: [`stack.release.json`](./stack.release.json)
- Compose file: [`packages/twenty-docker/docker-compose.yml`](./packages/twenty-docker/docker-compose.yml)
- Image tag env var: `CRM_IMAGE_TAG`

Production deployments must use the pinned image tag from `stack.release.json`; do not deploy `latest`.

## Local Docker run

```bash
cp packages/twenty-docker/.env.example packages/twenty-docker/.env
# Edit packages/twenty-docker/.env and set:
# - APP_SECRET
# - EXE_LICENSE_KEY
# - PG_DATABASE_PASSWORD
# - SERVER_URL

docker compose -f packages/twenty-docker/docker-compose.yml up -d
```

The install helper can also prepare a local Compose directory:

```bash
bash packages/twenty-docker/scripts/install.sh
```

## Health and operations

- Server readiness endpoint: `GET /healthz`
- Server container health: `/healthz`
- Worker container health: Redis queue connectivity probe
- Migrations run from the server entrypoint unless `DISABLE_DB_MIGRATIONS=true`
- Workers set `DISABLE_DB_MIGRATIONS=true` and `DISABLE_CRON_JOBS_REGISTRATION=true`

## Data ingestion

Exe CRM receives structured data from the shared AskExe ingestion layer. External API collection belongs in [exe-gateway](https://github.com/AskExe/exe-gateway); CRM consumes curated/routed records.

```text
External APIs → exe-gateway adapters → raw/staging data → routing → CRM records
```

The target architecture is a single customer-owned Postgres deployment with service-specific schemas and durable audit trails for imported records.

## Core capabilities

- Contacts, companies, opportunities/deals, activities, tasks, notes, files
- Custom objects and fields
- Role/permission management
- Workflow triggers/actions
- Email/calendar integrations when configured
- Admin health and queue visibility

## Development

```bash
yarn start
npx nx typecheck twenty-server
npx nx typecheck twenty-front
npx nx test twenty-server --runInBand
npx nx build twenty-server
npx nx build twenty-front
```

See [AGENTS.md](./AGENTS.md) for repository-specific development guidance.

## Security

Report Exe CRM vulnerabilities through AskExe support/security (`security@askexe.com`) with affected version, reproduction steps, impact, and redacted logs. See [`.github/SECURITY.md`](./.github/SECURITY.md).

## License and attribution

Exe CRM is an AGPLv3 fork of Twenty. Upstream attribution is preserved in [NOTICE](./NOTICE) and [LICENSE](./LICENSE).
