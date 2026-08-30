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

## Exe SSO deployment contract (apex session → CRM session)

The CRM does **not** accept a token in a URL. `exe-auth` deliberately stopped
appending `?access_token=` (bug 83ba9546 — tokens in URLs leak through history,
logs and `Referer`). The only supported hand-off is a **server-side cookie
exchange**:

```
browser (apex session on .<domain>)
  ├─ exe_access_token=1   non-HttpOnly sentinel, readable by JS, TRIGGERS the bridge
  └─ exe_sess=<GoTrue JWT> HttpOnly, the ONLY auth proof
        │
        ▼
GET /api/auth/gotrue-callback      ← the bridge, server-side
        │  verifies exe_sess against GoTrue, applies exe_perms
        ▼
302 /verify?loginToken=…           ← CRM mints its OWN native session (tokenPair)
```

Three deployment-side conditions must hold, and **each one of them fails
silently as "the login just bounces back to sign-in"** if it does not. All three
have bitten this stack in production.

### 1. `GOTRUE_JWT_SECRET` must be on the CRM container

GoTrue signs HS256 and deliberately omits HMAC keys from its JWKS endpoint
(publishing `k` would leak the secret to the internet). A CRM that has
`GOTRUE_URL` but no `GOTRUE_JWT_SECRET` therefore has **no key material at all**
and rejects every genuine session.

`packages/twenty-docker/docker-compose.yml` already passes it through. Any other
deployment manifest that composes this image must do the same — the variable
existing in the host's `.env` is not enough; it has to reach the container:

```bash
docker exec exe-crm sh -c 'env | grep -c GOTRUE_JWT_SECRET'   # must print 1
```

Since bug 2e2b5225 the server announces this at boot. Check the log line on any
new deployment:

```
GoTrue SSO bridge ready: GOTRUE_URL and GOTRUE_JWT_SECRET are both set.
```

An `ERROR` naming `GOTRUE_JWT_SECRET` instead means SSO cannot work, whatever
the reverse proxy does.

### 2. The reverse proxy must not gate on `tokenPair`, and must exempt the bridge

`tokenPair` is Twenty's **native** session cookie. It is minted only *after* the
bridge completes, so it is never present on a first document request. A proxy
that gates the CRM on `$cookie_tokenPair` creates a livelock: the gate bounces
to auth, auth sees a live apex session and bounces straight back, forever
(bug 24bd2802 — the fifth recurrence of this cookie-name class).

Gate on the apex sentinel that actually exists at gate time — the same cookie
the wiki and dashboard blocks use — and **exempt the bridge endpoint**, which
is the one route capable of producing the session the gate wants
(bug 311badfe):

```nginx
server {
    server_name crm.<domain>;

    set $sso_session_cookie $cookie_exe_access_token;   # NOT $cookie_tokenPair
    include /etc/nginx/snippets/sso-redirect.conf;

    location = /health   { auth_request off; proxy_pass http://sso_crm/healthz; }
    location = /healthz  { auth_request off; proxy_pass http://sso_crm/healthz; }
    location = /auth/logout { auth_request off; proxy_pass http://sso_crm/auth/logout; }

    # The SSO bridge MUST be reachable without a CRM session — it is what
    # creates one. Gating it is a closed loop.
    location = /api/auth/gotrue-callback { auth_request off; proxy_pass http://sso_crm; }

    location / { proxy_pass http://sso_crm; }
}
```

### 3. The identity must actually be entitled

A managed deployment (`EXE_ORG_ID` set) requires the GoTrue identity's
`app_metadata.exe_perms` to grant a CRM tier for that org. An identity with no
entry is refused — by design, and `CRM_REQUIRE_MANAGED_PERMS` is on by default.
Provision entitlements from the Exe dashboard rather than relaxing the gate.

### Diagnosing a bounce

Since bug 2e2b5225 the bridge says **why** it gave up, as a coarse non-secret
`?ssoError=` on the sign-in redirect:

| `ssoError`           | Meaning                                                       | Fix |
| -------------------- | ------------------------------------------------------------- | --- |
| `no_session`         | No apex `exe_sess` cookie, or no `GOTRUE_URL` configured       | Log in at `auth.<domain>`; check cookie domain is the apex |
| `token_unverifiable` | A session was present but could not be verified                | Almost always a missing `GOTRUE_JWT_SECRET` — see §1 |
| `invalid_claims`     | Verified, but the JWT carries no `email`/`sub`                 | Check the GoTrue user record |
| `no_crm_access`      | Managed org grants this identity no CRM tier                   | Grant `exe_perms` for the org — see §3 |
| `not_provisioned`    | Entitled, but no CRM account could be bound                    | Check `EXE_ORG_WORKSPACE_ID` and workspace membership |

Reaching the CRM sign-in page with **no** `ssoError` means the bridge was never
invoked at all — suspect the proxy gate (§2) or a frontend bundle that predates
`GoTrueCallbackRedirectEffect` (see "Deployed image provenance" below).

### Deployed image provenance

Only images built by `.github/workflows/release-stack-image.yml` carry the
`org.exe.*` chain-of-custody labels. An image without them was hand-built, and
its server and frontend halves are not guaranteed to come from the same tree —
which has already shipped a CRM whose server-side bridge existed but whose
frontend bundle had no `GoTrueCallbackRedirectEffect` to trigger it
(bug a7329726). Verify before trusting a deployment:

```bash
docker image inspect "$(docker inspect exe-crm --format '{{.Image}}')" \
  --format '{{json .Config.Labels}}' | tr ',' '\n' | grep org.exe.
```

No `org.exe.git_sha` means the running image never went through the pipeline.
Redeploy from a released tag rather than debugging its behaviour.

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
