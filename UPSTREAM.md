# Upstream sync — exe-crm ↔ twentyhq/twenty

`AskExe/exe-crm` is a fork of [twentyhq/twenty](https://github.com/twentyhq/twenty).
We pull upstream improvements on a quarterly cadence and apply them on top of our
brand/feature divergence. This document is the runbook.

## Remotes

```bash
# In ~/twenty (the local clone of AskExe/exe-crm)
git remote -v
# origin    git@github.com:AskExe/exe-crm.git
# upstream  https://github.com/twentyhq/twenty.git

# If upstream is missing:
git remote add upstream https://github.com/twentyhq/twenty.git
```

`main` must always track `origin/main`, never `upstream/main`. Verify after
clone:

```bash
git config --get branch.main.remote   # → origin
```

If it shows `upstream`, rebind immediately:

```bash
git branch --set-upstream-to=origin/main main
```

## Post-clone setup (run once)

`.git/hooks/` isn't versioned, so every fresh clone must install local hooks:

```bash
./tools/setup-hooks.sh
```

This installs a `pre-push` hook that refuses any push whose remote is
`upstream`. It is the safety net against a bare `git push` accidentally
firing branded commits at the public `twentyhq/twenty` repo.

## Sync flow (quarterly)

```bash
# 1. Make sure local main is clean and up to date with origin
git checkout main
git pull --ff-only origin main

# 2. Fetch upstream
git fetch upstream

# 3. Cut a sync branch off upstream/main
SYNC_DATE=$(date +%Y-%m)
git checkout -b sync/${SYNC_DATE} upstream/main

# 4. Merge our fork's main INTO the sync branch (preserves history)
git merge --no-ff main -m "merge: fork main into upstream sync ${SYNC_DATE}"

# 5. Resolve conflicts (see hotspots below). All brand conflicts resolve in
#    favor of exe-crm — never re-introduce "twenty" branding into the fork.

# 6. Push and open a PR against main
git push -u origin sync/${SYNC_DATE}
gh pr create --base main --head sync/${SYNC_DATE} \
  --title "Upstream sync ${SYNC_DATE}" \
  --body "Quarterly sync from twentyhq/twenty. See UPSTREAM.md."

# 7. CI runs ci-brand-drift on the PR. If "twenty" leaks back in,
#    fix the leak before merging — do not bypass the check.
```

## Conflict hotspots

When merging upstream, the highest-conflict areas are:

- `packages/*/package.json` — name fields, dependency versions, scripts. Keep
  `@askexe/*` package names; accept upstream dependency bumps unless they
  break the fork.
- `packages/twenty-ui/src/theme-constants/` — colors, typography, spacing.
  Keep Exe Foundry Bold tokens (#F5D76E gold, #0F0E1A bg, Epilogue/Manrope/
  Space Grotesk fonts) — never accept upstream Twenty palette/typography.
- `packages/twenty-ui/src/assets/logos/` and any logo SVG/PNG — keep AskExe
  logos.
- Email templates (`packages/twenty-emails/`) — keep AskExe sender, copy,
  branding.
- `README.md`, `NOTICE` — keep fork copy. AskExe attribution + AGPL
  acknowledgment must stay.
- Workflows under `.github/workflows/` — `cd-deploy-main.yaml` and
  `cd-deploy-tag.yaml` were disabled in T1-05 (replaced with a
  manual-only `workflow_dispatch` stub so they no longer auto-fire on
  push). Do not let upstream re-enable them by overwriting the stub
  during a sync. Our self-hosted deploy pipeline lands in Phase 3.

## Brand-drift CI

`.github/workflows/ci-brand-drift.yaml` runs on every PR and fails if a PR
diff adds the literal string `twenty` (case-insensitive) outside the
allowlist in `.brand-drift-allowlist.txt`.

The check uses the PR diff (added lines only), not a full repository scan,
so pre-existing strings never trigger it — only new leaks introduced by the
PR being reviewed. This makes the check coexist with the one-shot rename PR
in T1-04 without spurious failures.

## Allowlist policy

Add an entry to `.brand-drift-allowlist.txt` only when keeping the string is
legally or operationally required:

- Attribution / license text (LICENSE, NOTICE) — required by AGPL §5.
- Upstream remote configuration (UPSTREAM.md, this file).
- Fork changelog entries that reference upstream commits (CHANGELOG-fork.md).
- Markdown that links to upstream Twenty repo (e.g. README acknowledgment).

Every allowlist entry must include a comment explaining why it is permitted.
Coordination: T1-03 (NOTICE/README mentions) and T1-04 (rename allowlist)
both feed entries into this list — Tom 4 reconciles at merge.

## Rollback

If a sync goes badly:

```bash
git checkout main
git branch -D sync/${SYNC_DATE}
# delete the remote branch too
git push origin --delete sync/${SYNC_DATE}
```

Local fork main remains untouched until the sync PR is merged.

## Upstream sync mechanism audit — 2026-04-14

Context: 160 upstream commits (2026-03-29 → 2026-04-04) landed on `origin/main` between Phase 1 cleanup and this audit. Lane C resolution: cherry-picked 4 security fixes, force-pushed, then audited the ingestion path.

**Findings:**

- **No scheduled sync workflow exists.** `ls .github/workflows/ | grep -iE "sync|upstream|mirror|pull"` returns only disabled i18n pulls (Crowdin translations, not upstream code). No `sync-upstream.yml`, `pull-twentyhq.yml`, `mirror.yml` has ever existed in this repo. → No action needed.
- **No cron-triggered workflows.** `grep -l "schedule:" .github/workflows/*.{yml,yaml}` returns zero matches. → No action needed.
- **No rebrand/sync scripts pull upstream.** `scripts/rebrand/rebrand.sh` is our own rename replay — it assumes upstream code is already present, doesn't fetch it. → No action needed.
- **Fork-sync UI action is the likely ingestion path.** `gh api repos/AskExe/exe-crm` confirms `fork: true`, `parent: twentyhq/twenty`. GitHub's web UI "Sync fork" button pulls upstream/main into our origin/main on click. This cannot be disabled via API without unforking the repo.
- **Active workflows now limited to 2 (+ guard).** `gh workflow list` returns: `CD deploy main (DISABLED)`, `CD deploy tag (DISABLED)`, `Brand drift check (active guard)`. 28 upstream workflows were `.disabled` in Phase 1 (commit 06527318bf). → No further disable needed.
- **Pre-push git hook blocks local→upstream pushes** (installed in 32a92eb4fe). Does not block the GitHub UI "Sync fork" action — that's a server-side operation.

**Actions taken:**

- None required — no running automation found. The 160-commit drift came from either (a) a manual click of "Sync fork" in the GitHub UI, or (b) an older tom session that ran `git fetch upstream && git merge && git push origin main` before the pre-push guard was installed.

**Remaining risk + mitigation:**

- **GitHub "Sync fork" button** remains clickable by any collaborator with push access. Mitigation options (not taken — await founder/exe call):
  - Unfork via GitHub support (irreversible; loses "fork of twentyhq/twenty" attribution)
  - Restrict push access to main (branch protection) so "Sync fork" requires PR review
  - Document in CONTRIBUTING.md that "Sync fork" is forbidden; rely on social contract
- Recommend: branch protection + explicit CONTRIBUTING prohibition. Founder to decide.

**Evidence:**

```
$ gh api repos/AskExe/exe-crm --jq '{fork, parent: .parent.full_name, source: .source.full_name}'
{"fork":true,"parent":"twentyhq/twenty","source":"twentyhq/twenty"}

$ gh workflow list -R AskExe/exe-crm
CD deploy main (DISABLED)    active    260588064
CD deploy tag (DISABLED)     active    260588065
Brand drift check            active    260588066

$ ls .github/workflows/*.yaml | grep -v disabled
cd-deploy-main.yaml         # disabled via `if: false` per 06527318bf
cd-deploy-tag.yaml          # disabled via `if: false` per 06527318bf
ci-brand-drift.yaml         # our guard
```
