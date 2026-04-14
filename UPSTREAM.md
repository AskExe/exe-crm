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
