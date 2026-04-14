#!/usr/bin/env bash
#
# Installs local git hooks for this fork. Run once after cloning.
#
#   ./tools/setup-hooks.sh
#
# Hooks installed:
#   - pre-push: refuses any push whose remote is `upstream` (twentyhq/twenty).
#               The fork must never push branded commits to the public upstream.
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
HOOK

chmod +x "${PRE_PUSH}"

echo "Installed pre-push guard at ${PRE_PUSH}"
