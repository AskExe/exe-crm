#!/usr/bin/env bash
#
# Installs local git hooks for this fork. Run once after cloning.
#
#   ./tools/setup-hooks.sh
#
# Hooks installed:
#   - pre-push:
#       1. Refuses any push whose remote is `upstream` (twentyhq/twenty).
#          The fork must never push branded commits to the public upstream.
#       2. Refuses any push to `origin` where `upstream/main` is an ancestor
#          of HEAD (catches a full rebase or merge-from-upstream before it
#          leaves the machine). Cherry-picks DON'T trigger this.
#
# `.git/hooks/` is not versioned, so every fresh clone must run this script.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="${REPO_ROOT}/.git/hooks"
PRE_PUSH="${HOOKS_DIR}/pre-push"

mkdir -p "${HOOKS_DIR}"

cat > "${PRE_PUSH}" <<'HOOK'
#!/usr/bin/env bash
# Refuses any push whose remote name is `upstream` (twentyhq/twenty).
# Installed by tools/setup-hooks.sh — see UPSTREAM.md.
remote="$1"
if [ "${remote}" = "upstream" ]; then
  echo "REFUSED: pushing to upstream (twentyhq/twenty) is forbidden on this fork." >&2
  echo "If you need to contribute back upstream, open a PR from a separate clone." >&2
  exit 1
fi

# Anti-rebase guard — refuse pushes where upstream/main is an ancestor of HEAD.
# Cherry-picks DON'T trigger this (new SHAs). Full rebase / merge from upstream DO.
if [ "${remote}" = "origin" ]; then
  if git fetch --quiet upstream main 2>/dev/null; then
    if git merge-base --is-ancestor upstream/main HEAD 2>/dev/null; then
      echo "REFUSED: upstream/main is an ancestor of HEAD — looks like a full rebase or merge from upstream." >&2
      echo "" >&2
      echo "Per ARCHITECTURE.md § Upstream sync strategy (hard fork, 2026-04-14):" >&2
      echo "  - Cherry-pick individual security-labeled commits — OK" >&2
      echo "  - git pull upstream main / git rebase upstream/main — FORBIDDEN" >&2
      echo "" >&2
      echo "If you ACTUALLY need this (extremely rare), override:" >&2
      echo "  git push --no-verify" >&2
      echo "  (leaves no audit trail — disclose in commit message + ping exe)" >&2
      exit 1
    fi
  fi
fi
HOOK

chmod +x "${PRE_PUSH}"

echo "Installed pre-push guard at ${PRE_PUSH}"
