#!/usr/bin/env bash
#
# Sync @askexenow/exe-theme into exe-crm.
#
# @askexenow/exe-theme is not published to any registry, so its tokens are
# vendored into packages/twenty-ui/src/theme/constants/exe-theme/ and
# committed. Nothing here runs at build time — the build stays hermetic.
#
# NOTE ON DIRECTION OF TRUTH: exe-crm is the founder-approved reference look,
# and @askexenow/exe-theme was reconciled FROM this repo. So a resync that
# changes any generated CSS is a red flag, not an update. Always re-run
# `yarn generate:theme` afterwards and confirm theme-dark.css / theme-light.css
# come back byte-identical.
#
#   ./packages/twenty-ui/scripts/sync-exe-theme.sh
#   EXE_THEME_REF=main ./packages/twenty-ui/scripts/sync-exe-theme.sh
#
set -euo pipefail

EXE_THEME_REF="${EXE_THEME_REF:-47d54b58}"
EXE_THEME_BRANCH="fix/exe-theme-reconcile-crm"
SRC_REPO="AskExe/exe-os"

PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${PACKAGE_ROOT}/src/theme/constants/exe-theme"
mkdir -p "${DEST}"

LOCAL_EXE_OS="${EXE_OS_PATH:-${HOME}/exe-os}"

fetch() {
  if [ -d "${LOCAL_EXE_OS}/.git" ] \
     && git -C "${LOCAL_EXE_OS}" cat-file -e "${EXE_THEME_REF}:$1" 2>/dev/null; then
    git -C "${LOCAL_EXE_OS}" show "${EXE_THEME_REF}:$1"
  elif command -v gh >/dev/null 2>&1; then
    gh api "repos/${SRC_REPO}/contents/$1?ref=${EXE_THEME_REF}" --jq '.content' | base64 -d
  else
    echo "sync-exe-theme: cannot read $1 — no local exe-os checkout at ${LOCAL_EXE_OS} and no gh CLI" >&2
    return 1
  fi
}

{
  cat <<JSON
{
  "_provenance": {
    "source": "${SRC_REPO}",
    "path": "packages/exe-theme/tokens.json",
    "branch": "${EXE_THEME_BRANCH}",
    "commit": "${EXE_THEME_REF}",
    "resync": "run packages/twenty-ui/scripts/sync-exe-theme.sh",
    "note": "Generated file - do not edit by hand. Edit @askexenow/exe-theme upstream and resync."
  },
JSON
  fetch "packages/exe-theme/tokens.json" | tail -n +2
} > "${DEST}/tokens.json"

# Emit the .ts module the app actually imports. See the header it writes for
# why this is not a raw JSON import.
python3 - "${DEST}" <<'PY'
import json, sys, os
dest = sys.argv[1]
d = json.load(open(os.path.join(dest, 'tokens.json')))
prov = d['_provenance']
body = {k: v for k, v in d.items() if k != '_provenance'}

def emit(o, indent=2):
    pad = ' ' * indent
    out = []
    for k, v in o.items():
        if isinstance(v, dict):
            out.append(f"{pad}{k}: {{")
            out.append(emit(v, indent + 2))
            out.append(f"{pad}}},")
        else:
            out.append(f"{pad}{k}: {json.dumps(v)},")
    return '\n'.join(out)

ts = f"""// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Source : {prov['source']}  {prov['path']}
// Branch : {prov['branch']}
// Commit : {prov['commit']}
// Resync : {prov['resync']}
//
// Generated from the vendored tokens.json next to this file. It exists as a
// .ts module rather than a raw JSON import because these tokens are evaluated
// by four different toolchains (tsx for the theme-CSS generator, Vite/Linaria
// at build time for twenty-front, Jest/SWC in tests, and the Nest server), and
// a JSON import is the one thing that does not resolve identically in all of
// them. tokens.json stays the canonical vendored artefact.

export const exeThemeTokens = {{
{emit(body)}
}} as const;
"""
open(os.path.join(dest, 'tokens.ts'), 'w').write(ts)
PY

# Keep the generated .ts prettier-clean so a resync is byte-stable and does not
# trip the repo's formatting hook. Skipped if prettier is unavailable.
if npx --no-install prettier --write "${DEST}/tokens.ts" >/dev/null 2>&1; then
  echo "sync-exe-theme: formatted tokens.ts with prettier"
else
  echo "sync-exe-theme: prettier unavailable — tokens.ts left unformatted" >&2
fi

echo "sync-exe-theme: wrote ${DEST}/tokens.json and ${DEST}/tokens.ts at ref ${EXE_THEME_REF}"
echo "sync-exe-theme: now run 'yarn generate:theme' and confirm the generated CSS is UNCHANGED."
