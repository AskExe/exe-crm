# Forensic provenance record: historical exe-crm images (bug 615c14d9)

**Date of inspection:** 2026-08-19
**Bug:** 615c14d9 — registry write restricted to CI (historical image provenance + detection control)

## Method

Live registry inspection of `ghcr.io/askexe/exe-crm`:

- Image labels read anonymously via `docker buildx imagetools inspect <ref> --raw`. Multi-arch indexes were resolved to their **linux/amd64** child manifest, then the child's config blob was read for its `Labels` (`.config.Labels` / `.container_config.Labels`).
- Git tags checked via the GitHub API.
- The token used for the API-side inspection had scopes `repo`/`read:org` only (**no `read:packages`**); label reads succeeded anonymously via imagetools, so the findings below are complete for the amd64 config layer.

## Findings (amd64 config labels, verbatim)

| Version | amd64 digest | image revision label | git tag | verdict |
| --- | --- | --- | --- | --- |
| v0.9.47 | `sha256:843e3d20f547ed37137639c165f0543e21e8eff47b4e04d3d3b14e047ba76d87` | `org.opencontainers.image.revision=0372f9b44014f7ac37792e8e21287c3e75395b68`, `org.opencontainers.image.version=0.9.47`, source present | `v0.9.47` → `0372f9b44014f7ac37792e8e21287c3e75395b68` ("chore: bump v0.9.47 for stack release", 2026-06-09, matches) | Pipeline-built, fully traceable (last green release) |
| v0.9.48 | `sha256:b9d7827630d9b52abf90119f70b3aa12d4f47b521112d9082b5edbead56312a4` | none — source + description only, no revision/version, no `org.exe.*` | `v0.9.48` → `0f511590bbb944d26d8cdfc68d29803b0877beb7` exists | Hand-built; a git tag exists but the image carries no revision label, so the image contents are not provably from that commit |
| v0.9.49 | `sha256:7f7e6e9ffbe02753396a6414bf8454a6ce369f164923a5e77bbac0a52ce5c17b` | none — source + description only | NO git tag `v0.9.49` (404) | Hand-built and unrecoverable — no image revision label and no git tag |
| v0.9.51 | `sha256:fe4d3111ce98e32ba15aad88658372256fb27d99cca89fffbaa11d533a8452ce` | none — source + description only (description "Exe CRM — AI-native CRM (AGPLv3)") | `v0.9.51` → `5402f9e187a5eda0317e25884c3acf503e6f004b` exists | Hand-built; git tag exists, image unlabeled |
| v0.9.52 | `sha256:94d3b295ca3c7ea53112b6f3b4fe02e2de319d2decc8769b55894921ce212788` | `org.opencontainers.image.revision=3d3338869e69636b9ff75ca33c252aba1ba05b8e`, `org.opencontainers.image.version=0.9.52`, source present; NO `org.exe.*` chain-of-custody set | NO git tag `v0.9.52` (404). Commit `3d3338869e69636b9ff75ca33c252aba1ba05b8e` is real: "Merge pull request #51 from AskExe/fix/reaudit-4f255b0d-hardening — fix(release): exe-crm P0 re-audit — digest pins, scans, green-CI gate", 2026-06-30 | Partially traceable — the image records a real commit via `opencontainers.revision`, but it was not produced by the audited verify-image-provenance pipeline (which stamps `org.exe.*`), and there is no git tag |
| v0.9.53 **(THE IMAGE RUNNING IN PRODUCTION on exe-db-jkt)** | `sha256:d67d2677c2d33087b39efd7a8215e009f8264800b9de6f944826a9b1e9ca7a37` | none — source + description only, no revision/version, no `org.exe.*` | NO git tag `v0.9.53` (404) | **UNRECOVERABLE** — the production image's source commit cannot be proven from either the registry or git. This is the exact concern the bug raised, now confirmed with data |

## Conclusions

- **v0.9.47 is the last fully pipeline-built, traceable release.**
- **v0.9.48, v0.9.49, v0.9.51, v0.9.53 are hand-built and carry no provenance labels.**
- **v0.9.53 — the image that was serving PRODUCTION — has neither an image revision label nor a git tag, so its exact source commit is UNRECOVERABLE.**
- **v0.9.52 records commit `3d3338869e` (PR #51 re-audit) via `opencontainers.revision`** but was not produced by the audited pipeline and has no git tag.

## Remediation status

- **Forward provenance (future releases):** enforced by `.github/workflows/release-stack-image.yml` + `.github/scripts/verify-image-provenance.py`, which stamp and fail-close on the `org.exe.*` chain-of-custody labels.
- **Ongoing detection (new hand-built images):** `.github/workflows/registry-provenance-audit.yml` audits every published tag daily via `.github/scripts/audit-registry-provenance.py` and alerts on any unverified tag that is not allowlisted.
- **Historical tags:** recorded in `.github/known-unprovenanced-tags.txt` (v0.9.48, v0.9.49, v0.9.51, v0.9.52, v0.9.53) and treated as KNOWN-LEGACY by the audit rather than alerting forever. v0.9.47 is deliberately NOT listed — it is pipeline-built and verified-traceable.

## Required founder action (registry write restriction)

The enforcement half of "restrict registry write to CI" is a **manual founder step in the GitHub org package UI** — it cannot be done via `gh api` with a normal token:

1. Open the package settings for `ghcr.io/askexe/exe-crm` in the AskExe org.
2. Under **Manage Actions access**, set the repository access to the `exe-crm` repo (so CI in that repo can push), and remove any personal or broad write access.
3. Use a dedicated least-privilege push credential (`GHCR_TOKEN` secret) scoped to `write:packages` for that single package only — never a personal token with org-wide package write.

Once write is restricted to CI, anything that bypasses it (a hand-built push with a borrowed credential) is caught by the registry provenance audit workflow above.
