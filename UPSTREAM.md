# Upstream strategy — exe-crm

`AskExe/exe-crm` is a **hard fork** of [twentyhq/twenty](https://github.com/twentyhq/twenty).
We do NOT rebase. We do NOT sync. Monthly scan of upstream CVE-labeled / security-advisory
commits only — cherry-pick those individually. Everything else diverges permanently.
Architecture reference: `exe-os/.planning/ARCHITECTURE.md § Upstream sync strategy (locked 2026-04-14)`.

## Remotes

```bash
# In ~/twenty (the local clone of AskExe/exe-crm)
git remote -v
# origin    git@github.com:AskExe/exe-crm.git
# upstream  https://github.com/twentyhq/twenty.git

# If upstream is missing:
git remote add upstream https://github.com/twentyhq/twenty.git
```

`upstream` is kept configured for READ-ONLY fetch — needed so the monthly security
cherry-pick pass and the pre-push anti-rebase hook can both see upstream commits.
`main` must always track `origin/main`, never `upstream/main`. Verify after clone:

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

This installs a `pre-push` hook that:

1. Refuses any push whose remote name is `upstream` (no branded commits to public Twenty).
2. Refuses any push to `origin` where `upstream/main` is an ancestor of HEAD
   (catches a full rebase or merge-from-upstream before it leaves the machine).

## Full-rebase / merge-from-upstream is FORBIDDEN

This workflow is forbidden — see hard-fork statement above. The pre-push
anti-rebase guard (see `.git/hooks/pre-push`) refuses any push where
`upstream/main` is an ancestor of HEAD. Extremely rare overrides require
`git push --no-verify` **plus** disclosure in the commit message + ping exe.

Historic note: earlier versions of this doc described a "quarterly rebase"
cadence. That workflow has been retired. If you find references to
`git pull upstream main`, `git rebase upstream/main`, `git merge upstream/main`,
or "sync fork" automation in scripts or CI, delete or disable them.

## Monthly security cherry-pick (the only sanctioned upstream ingestion)

Scope: **only** commits that fix a CVE, carry a GitHub Security Advisory label,
or patch a CVSS-scored vulnerability. No features. No refactors. No "nice to haves".

```bash
# 1. Clean main
git checkout main
git pull --ff-only origin main

# 2. Fetch upstream (read-only)
git fetch upstream

# 3. List upstream commits since our last security sync
#    Inspect messages for CVE / security / vulnerability keywords
git log --oneline upstream/main --not origin/main --grep='CVE\|security\|vulnerab\|XSS\|SSRF\|injection' -i

# 4. Cherry-pick each security commit individually in chronological order
git cherry-pick <sha>
# Resolve conflicts in favor of exe-crm branding. Never re-introduce "twenty"
# in user-facing strings (see Brand drift below).

# 5. Push normally to origin/main (pre-push hook passes — new SHAs, not a rebase)
git push origin main
```

## Conflict hotspots (during cherry-pick)

When cherry-picking, the highest-conflict areas are:

- `packages/*/package.json` — name fields, dependency versions. Keep
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
  `cd-deploy-tag.yaml` are disabled stubs. Do not let an upstream cherry-pick
  re-enable them. Our self-hosted deploy pipeline lands in Phase 3.

## Brand-drift CI

`.github/workflows/ci-brand-drift.yaml` runs on every PR and fails if a PR
diff adds the literal string `twenty` (case-insensitive) outside the
allowlist in `.brand-drift-allowlist.txt`.

The check uses the PR diff (added lines only), not a full repository scan,
so pre-existing strings never trigger it — only new leaks introduced by the
PR being reviewed.

## Allowlist policy

Add an entry to `.brand-drift-allowlist.txt` only when keeping the string is
legally or operationally required:

- Attribution / license text (LICENSE, NOTICE) — required by AGPL §5.
- Upstream remote configuration (UPSTREAM.md, this file).
- Fork changelog entries that reference upstream commits (CHANGELOG-fork.md).
- Markdown that links to upstream Twenty repo (e.g. README acknowledgment).

Every allowlist entry must include a comment explaining why it is permitted.

## Rollback (cherry-pick gone wrong)

If a security cherry-pick introduces a regression:

```bash
git checkout main
git revert <cherry-pick-sha>
git push origin main
```

Use `git revert` (new commit), not `git reset --hard` + force push. We preserve
history.

## Upstream sync mechanism audit — 2026-04-14

Context: 160 upstream commits (2026-03-29 → 2026-04-04) landed on `origin/main`
between Phase 1 cleanup and this audit. Lane C resolution: cherry-picked 4
security fixes, force-pushed, then audited the ingestion path.

**Findings:**

- **No scheduled sync workflow exists.** `ls .github/workflows/ | grep -iE "sync|upstream|mirror|pull"`
  returns only disabled i18n pulls (Crowdin translations, not upstream code).
  No `sync-upstream.yml`, `pull-twentyhq.yml`, `mirror.yml` has ever existed. → No action needed.
- **No cron-triggered workflows.** `grep -l "schedule:" .github/workflows/*.{yml,yaml}`
  returns zero matches. → No action needed.
- **No rebrand/sync scripts pull upstream.** `scripts/rebrand/rebrand.sh` is our
  own rename replay — it assumes upstream code is already present, doesn't
  fetch it. → No action needed.
- **Fork-sync UI action is the likely ingestion path.** `gh api repos/AskExe/exe-crm`
  confirms `fork: true`, `parent: twentyhq/twenty`. GitHub's web UI "Sync fork"
  button pulls upstream/main into our origin/main on click. Cannot be disabled
  via API without unforking the repo.
- **Active workflows now limited to 2 (+ guard).** `gh workflow list` returns:
  `CD deploy main (DISABLED)`, `CD deploy tag (DISABLED)`, `Brand drift check
  (active guard)`. 28 upstream workflows were `.disabled` in Phase 1 (commit
  06527318bf). → No further disable needed.
- **Pre-push git hook blocks local→upstream pushes** (installed in 32a92eb4fe)
  and, as of 2026-04-14, also blocks pushes where `upstream/main` is an ancestor
  of HEAD. Does not block the GitHub UI "Sync fork" action — that's a
  server-side operation.

**Remaining risk + mitigation:**

- **GitHub "Sync fork" button** remains clickable by any collaborator with push
  access. Mitigation options (not taken — await founder/exe call):
  - Unfork via GitHub support (irreversible; loses "fork of twentyhq/twenty" attribution)
  - Restrict push access to main (branch protection) so "Sync fork" requires PR review
  - Document in CONTRIBUTING.md that "Sync fork" is forbidden; rely on social contract
- Recommend: branch protection + explicit CONTRIBUTING prohibition. Founder to decide.

## Internal package names (intentionally unchanged)

The `packages/` directory retains upstream `twenty-*` names (`twenty-front`,
`twenty-server`, `twenty-emails`, etc.). This is **intentional** — renaming
these directories would break the NX monorepo build system, workspace
references in `package.json` files, and hundreds of cross-package imports.

User-visible branding (HTML titles, email copy, Docker labels, Helm charts)
has been rebranded to "Exe CRM". Internal directory names are implementation
detail, not user-facing.

Code review on this fork is automated by the `codex-review` check (see
`.github/workflows/codex-review.yml`); a clean review approves the PR, and any
[P0]/[P1] finding blocks the merge and still requires a human.
