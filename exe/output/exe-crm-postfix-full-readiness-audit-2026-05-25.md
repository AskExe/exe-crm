# exe-crm Post-Fix Full Readiness Audit — 2026-05-25

## Verdict

**Repo-level readiness: GREEN with one external release gate pending.**

The repo now passes the audited customer-readiness, production-readiness, update, security, and code-quality gates that can be verified locally. During this fresh pass I found one more release-surface drift issue in legacy Kubernetes/Podman files and fixed it in commit `867fd5aad3 fix: pin legacy deployment surfaces to crm release`.

**External gate still pending:** GitHub rejected three `git push origin main` attempts with a remote `Internal Server Error`. The fix is committed locally on `main` and must be pushed once GitHub accepts the request.

## Scope audited

- Customer install path and first-run docs
- Production Docker Compose contract
- Stack update/image version contract
- Helm/raw Kubernetes/Podman deployment surfaces
- Health/self-heal signals
- Security posture and production dependency audit
- Code-quality gates: typecheck, tests, builds, formatting, regression tests
- Branding/customer drift from upstream Twenty where it affects customer readiness

## Findings and status

| Area | Status | Evidence |
| --- | --- | --- |
| Customer readiness | GREEN | README, DEPLOY, CONTRACTS, SECURITY, install script, `.env.example`, and Compose now describe Exe CRM and AskExe support paths. |
| Production readiness | GREEN | Compose parses with required production env, server/worker use pinned GHCR image, health checks verify DB + Redis + queue Redis. |
| Update readiness | GREEN | `stack.release.json`, Compose, `.env.example`, installer, Helm appVersion, raw K8s, and Podman are aligned to `ghcr.io/askexe/exe-crm:v0.9.3` / `CRM_IMAGE_TAG`. |
| Security | GREEN | Production high-severity Yarn audit exits clean; previous SQL interpolation and BullMQ idempotency blockers were fixed. |
| Self-heal / operability | GREEN | `/healthz` now fails on DB/Redis/queue outage instead of returning a shallow static OK; worker healthcheck verifies Redis TCP connectivity. |
| Code quality | GREEN for release gate | Typechecks, server build, frontend build, focused tests, regression tests, and formatting passed. Large-bundle and TS-hygiene debt remain non-blocking follow-ups. |

## Fix applied during this fresh audit

Commit: `867fd5aad3 fix: pin legacy deployment surfaces to crm release`

Changed:

- `packages/twenty-docker/helm/twenty/Chart.yaml`
  - `appVersion` now matches stack release `v0.9.3`.
- `packages/twenty-docker/k8s/manifests/deployment-server.yaml`
  - Raw Kubernetes server image now pins `ghcr.io/askexe/exe-crm:v0.9.3`.
- `packages/twenty-docker/k8s/manifests/deployment-worker.yaml`
  - Raw Kubernetes worker image now pins `ghcr.io/askexe/exe-crm:v0.9.3`.
- `packages/twenty-docker/podman/manual-steps-to-deploy-twenty-on-podman`
  - Removed invalid `docker.io/ghcr.io/...` image references and pinned `ghcr.io/askexe/exe-crm:v0.9.3`.
- `packages/twenty-docker/k8s/README.md`
  - Updated customer-facing K8s docs from upstream Twenty clone/support language to Exe CRM/AskExe language.
- `tests/vps-crm-audit.test.ts`
  - Added regression coverage proving stack release, Compose, Helm, raw K8s, and Podman stay pinned to the same release image and do not drift back to stale tags.

## Verification commands run

Passed:

```bash
bash -n packages/twenty-docker/scripts/install.sh
python3 -m json.tool stack.release.json
docker compose -f packages/twenty-docker/docker-compose.yml config
npx vitest run tests/vps-crm-audit.test.ts
npx jest packages/twenty-server/src/engine/core-modules/health/controllers/__tests__/health.controller.spec.ts --config=packages/twenty-server/jest.config.mjs --runInBand
yarn npm audit --all --environment production --severity high --json
npx nx typecheck twenty-server --skip-nx-cache
npx nx typecheck twenty-front --skip-nx-cache
npx nx build twenty-server --skip-nx-cache
npx nx build twenty-front --skip-nx-cache
yarn prettier --check --ignore-unknown packages/twenty-docker/k8s/README.md packages/twenty-docker/k8s/manifests/deployment-server.yaml packages/twenty-docker/k8s/manifests/deployment-worker.yaml packages/twenty-docker/podman/manual-steps-to-deploy-twenty-on-podman packages/twenty-docker/helm/twenty/Chart.yaml
git diff --check
```

Drift scan clean for blocking customer-release patterns:

```bash
rg -n "ghcr.io/askexe/exe-crm:(2\.2\.0|v1\.14\.0)|docker\.io/ghcr\.io|TAG:-0\.9\.95|twentycrm/twenty:latest|security at twenty\.com|docs\.twenty\.com|www\.twenty\.com" README.md DEPLOY.md CONTRACTS.md .github/SECURITY.md packages/twenty-docker tests stack.release.json
```

Only expected upstream attribution remains in `README.md` linking to Twenty as the AGPL upstream project.

## Non-blocking follow-ups

These do **not** block the current repo-level customer release, but they are real product hardening items:

1. **Frontend bundle budget/performance:** production build passes, but several chunks are multi-MB. Add explicit bundle budgets and split the largest editor/schema/runtime chunks later.
2. **TypeScript hygiene debt:** broad repo metric scan found high historical counts: `any` references, `@ts-ignore/@ts-expect-error`, `eslint-disable`, TODO/FIXME, and default exports. This is inherited monorepo debt, not a blocker for today’s release, but should be reduced by area as files are touched.
3. **Target VPS smoke:** repo gates pass locally; final release still needs GHCR image publish plus smoke on a real customer VPS using the pinned image.
4. **Backup/rollback automation:** docs now mention backup/rollback expectations, but fully automated pre-migration backup/restore orchestration is not yet implemented in this repo.

## Git state

- Latest local commit: `867fd5aad3 fix: pin legacy deployment surfaces to crm release`
- Push status: **not pushed** because GitHub returned remote `Internal Server Error` three times.
- Local-only uncommitted file intentionally excluded: `.codex/config.toml`.
