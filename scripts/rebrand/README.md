# scripts/rebrand — twenty-* → exe-crm-* migration

This directory holds `rebrand.sh`, the canonical script that performs the
package rename for AskExe/exe-crm and re-applies it after upstream syncs
that re-introduce `twenty-*` paths.

## Why a script and not a one-shot PR

After every quarterly upstream sync (see `UPSTREAM.md`), the merge brings
back `twenty-*` paths in newly-added files. We re-run this script on the
sync branch to scrub them before merging into `main`. Owning the migration
as code (not as a one-shot PR) keeps the scrub reproducible.

## Phases

| Phase | What it does                                                      | Manual step after            |
|-------|-------------------------------------------------------------------|-------------------------------|
| 1     | Delete marketing subpackages, drop from workspaces + oxlint scope | git status; commit            |
| 2     | `git mv` package dirs `twenty-*` → `exe-crm-*` (preserves history)| `yarn install`                |
| 3     | Rewrite imports, package.json names, tsconfig paths, workspaces   | `yarn build && yarn test`     |
| 4     | Docker compose / Dockerfile / helm chart specific edits           | `docker compose ... config`   |
| verify| Grep for residual `twenty-*` references                           | (none — exits non-zero if any)|

## Running

```bash
# From repo root, on a clean working tree:
./scripts/rebrand/rebrand.sh phase1
git status
git commit -am "rebrand: phase 1 — delete marketing subpackages"

./scripts/rebrand/rebrand.sh phase2
yarn install
git commit -am "rebrand: phase 2 — git mv package directories"

./scripts/rebrand/rebrand.sh phase3
yarn install
yarn build
yarn test
git commit -am "rebrand: phase 3 — rewrite import paths"

./scripts/rebrand/rebrand.sh phase4
docker compose -f packages/exe-crm-docker/docker-compose.yml config >/dev/null
git commit -am "rebrand: phase 4 — Docker + helm rebrand"

./scripts/rebrand/rebrand.sh verify
```

## Why phases (and not `all`)

`yarn install` and `yarn build` are slow (many minutes each) and can surface
issues that need fixes between steps:

- **Phase 2 → install:** Yarn's workspace resolver needs to see the new dir
  layout before phase 3 rewrites import paths. Skipping the install causes
  phase 3 to leave dangling `node_modules/twenty-*` symlinks that fail later.
- **Phase 3 → build → test:** A typo in the import-path sed substitutions
  surfaces as a TypeScript error in phase 3's compile, not phase 4.
  Catching it here keeps the next phase's diff clean.
- **`all` mode** runs everything end-to-end without checkpoints. It exists
  for CI scripts that have already validated each phase locally; do not
  use it for the first run after an upstream sync.

## Idempotence

Every phase is safe to re-run. `phase1` skips packages already deleted.
`phase2` skips renames already applied. `phase3` is a no-op on an
already-renamed tree because `twenty-*` strings have been substituted out.

## What this script does NOT do

- It does not run `yarn install`, `yarn build`, or `yarn test` for you.
  These need interactive supervision; the script intentionally stops at
  each phase boundary.
- It does not rewrite `LICENSE`, `NOTICE`, `UPSTREAM.md`, or
  `.brand-drift-allowlist.txt` — these are the legitimate `twenty`
  references that must stay (AGPL §5 attribution).
- It does not touch files inside `node_modules`, `dist`, `build`,
  `.yarn`, `.next`, `coverage`, or `.git`.
- It does not handle SQL data migrations (rename of database `twenty` →
  `exe_crm`). Phase 4 updates the compose env vars but the dev DB needs
  to be re-created or migrated manually.

## Coordination with brand-drift CI

After phase 3 lands on `main`, all PR-added `twenty-*` references will
fail the `ci-brand-drift` check. The `phase verify` step is a local
pre-commit version of the same scan.
