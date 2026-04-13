#!/usr/bin/env bash
# rebrand.sh — Replay the twenty-* → exe-crm-* package rename for AskExe/exe-crm.
#
# Re-runnable by design. Each phase is gated and idempotent so a sync from
# upstream that re-introduces twenty-* paths can be cleansed by re-running
# this script.
#
# Usage:
#   ./scripts/rebrand/rebrand.sh phase1     # delete marketing subpackages
#   ./scripts/rebrand/rebrand.sh phase2     # rename package directories (git mv)
#   ./scripts/rebrand/rebrand.sh phase3     # rewrite import paths + package.json names
#   ./scripts/rebrand/rebrand.sh phase4     # docker compose / Dockerfile / helm
#   ./scripts/rebrand/rebrand.sh verify     # grep for residual twenty-* references
#   ./scripts/rebrand/rebrand.sh all        # phase1..phase4 + verify
#
# After phase2, ALWAYS run:  yarn install
# After phase3, ALWAYS run:  yarn build && yarn test
# After phase4, ALWAYS run:  docker compose -f packages/exe-crm-docker/docker-compose.yml config
#
# Read scripts/rebrand/README.md before running.

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants — single source of truth for the rename mapping.
# ---------------------------------------------------------------------------

# Surviving packages that get renamed twenty-X → exe-crm-X.
# Order matters only for git mv: parents before children. None nested here.
SURVIVING_PACKAGES=(
  "twenty-front"
  "twenty-server"
  "twenty-emails"
  "twenty-ui"
  "twenty-utils"
  "twenty-zapier"
  "twenty-e2e-testing"
  "twenty-shared"
  "twenty-sdk"
  "twenty-client-sdk"
  "twenty-apps"
  "twenty-cli"
  "twenty-oxlint-rules"
  "twenty-companion"
  "twenty-docker"
)
# Note: create-twenty-app handled separately — it is a CLI, name = "create-exe-crm-app".

# Marketing subpackages deleted per founder Q3 decision.
MARKETING_PACKAGES=(
  "twenty-docs"
  "twenty-website"
  "twenty-website-new"
)

# Repo root resolved relative to this script (scripts/rebrand/rebrand.sh).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() { printf '\033[1;36m[rebrand]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[rebrand WARN]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[rebrand ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

require_clean_tree() {
  if ! git -C "${REPO_ROOT}" diff --quiet || ! git -C "${REPO_ROOT}" diff --cached --quiet; then
    fail "Working tree is dirty. Commit or stash before running rebrand."
  fi
}

# Run a sed-in-place portably across BSD (macOS) and GNU.
sed_inplace() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

# Exclude paths that should never be rewritten:
#   - .git, node_modules, dist, build, .yarn (caches)
#   - LICENSE, NOTICE, UPSTREAM.md, .brand-drift-allowlist.txt (legitimate "twenty" mentions)
#   - This script itself
EXCLUDE_FIND_ARGS=(
  -not -path '*/node_modules/*'
  -not -path '*/.git/*'
  -not -path '*/dist/*'
  -not -path '*/build/*'
  -not -path '*/.yarn/*'
  -not -path '*/.next/*'
  -not -path '*/coverage/*'
  -not -name 'LICENSE'
  -not -name 'NOTICE'
  -not -name 'UPSTREAM.md'
  -not -name '.brand-drift-allowlist.txt'
  -not -path '*/scripts/rebrand/*'
)

# ---------------------------------------------------------------------------
# Phase 1: Delete marketing subpackages
# ---------------------------------------------------------------------------

phase1_delete_marketing() {
  log "Phase 1: deleting marketing subpackages (twenty-docs, twenty-website, twenty-website-new)"
  cd "${REPO_ROOT}"

  # Safety check: anything outside the to-be-deleted dirs that imports from them?
  log "Phase 1 safety check: grep for imports from marketing packages outside marketing dirs"
  local hits
  hits=$(grep -rl --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
    -E "from ['\"](twenty-docs|twenty-website|twenty-website-new)" packages/ 2>/dev/null \
    | grep -vE "^packages/(twenty-docs|twenty-website|twenty-website-new)/" || true)
  if [ -n "${hits}" ]; then
    warn "Found imports from marketing packages outside their own dirs:"
    echo "${hits}" | sed 's/^/  /' >&2
    fail "Resolve these imports before deleting marketing subpackages."
  fi

  for pkg in "${MARKETING_PACKAGES[@]}"; do
    if [ -d "packages/${pkg}" ]; then
      log "  git rm -r packages/${pkg}"
      git rm -rq "packages/${pkg}"
    else
      log "  packages/${pkg} already removed — skipping"
    fi
  done

  # Drop marketing entries from root package.json workspaces.packages array.
  log "Phase 1: removing marketing entries from root package.json workspaces"
  for pkg in "${MARKETING_PACKAGES[@]}"; do
    sed_inplace "/\"packages\/${pkg}\"/d" package.json
  done
  # Clean up trailing-comma artifact from removing array entries.
  sed_inplace -E 's/,([[:space:]]*\])/\1/g' package.json

  # Drop marketing scope from oxlint module-boundary rules.
  local oxlint="packages/twenty-oxlint-rules/rules/enforce-module-boundaries.ts"
  if [ -f "${oxlint}" ]; then
    log "Phase 1: removing marketing scope entries from ${oxlint}"
    sed_inplace -E "/^[[:space:]]*'twenty-(docs|website|website-new)':/d" "${oxlint}"
  fi

  log "Phase 1 done. Run: git status; review the diff; commit."
}

# ---------------------------------------------------------------------------
# Phase 2: git mv directory paths (preserves history)
# ---------------------------------------------------------------------------

phase2_rename_directories() {
  log "Phase 2: renaming surviving package directories with git mv (preserves history)"
  cd "${REPO_ROOT}"
  require_clean_tree

  for pkg in "${SURVIVING_PACKAGES[@]}"; do
    local src="packages/${pkg}"
    local dst="packages/${pkg/twenty-/exe-crm-}"
    if [ -d "${src}" ] && [ ! -d "${dst}" ]; then
      log "  git mv ${src} → ${dst}"
      git mv "${src}" "${dst}"
    elif [ -d "${dst}" ]; then
      log "  ${dst} already exists — skipping"
    else
      warn "  ${src} not found — skipping (may have been deleted)"
    fi
  done

  # Special case: create-twenty-app
  if [ -d "packages/create-twenty-app" ] && [ ! -d "packages/create-exe-crm-app" ]; then
    log "  git mv packages/create-twenty-app → packages/create-exe-crm-app"
    git mv "packages/create-twenty-app" "packages/create-exe-crm-app"
  fi

  # Helm chart directory
  local helm_old="packages/exe-crm-docker/helm/twenty"
  local helm_new="packages/exe-crm-docker/helm/exe-crm"
  if [ -d "${helm_old}" ] && [ ! -d "${helm_new}" ]; then
    log "  git mv ${helm_old} → ${helm_new}"
    git mv "${helm_old}" "${helm_new}"
  fi

  log "Phase 2 done. Update root package.json workspaces (next phase). Run yarn install AFTER phase 3."
}

# ---------------------------------------------------------------------------
# Phase 3: Rewrite import paths + package.json names + workspace globs
# ---------------------------------------------------------------------------

phase3_rewrite_imports() {
  log "Phase 3: rewriting import paths + package.json names + tsconfig path mappings"
  cd "${REPO_ROOT}"

  # Build sed substitutions: twenty-X → exe-crm-X for surviving package basenames only.
  # Order matters: longest first to avoid partial overlaps. We rely on the suffix
  # being unique so this is safe.
  local subs=()
  for pkg in "${SURVIVING_PACKAGES[@]}"; do
    local new="${pkg/twenty-/exe-crm-}"
    subs+=("-e" "s|${pkg}|${new}|g")
  done
  subs+=("-e" "s|create-twenty-app|create-exe-crm-app|g")
  # Root package name in root package.json + helm chart name
  subs+=("-e" 's|"name": "twenty"|"name": "exe-crm"|')

  # File extensions to rewrite. Excludes binary + lock files.
  local globs=(
    -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx'
    -o -name '*.json' -o -name '*.yaml' -o -name '*.yml'
    -o -name '*.md' -o -name '*.mdx' -o -name '*.html' -o -name '*.css'
    -o -name 'Dockerfile*' -o -name '*.sh' -o -name '*.env'
  )

  log "  Rewriting (this may take a minute)..."
  # shellcheck disable=SC2068
  find . -type f \( ${globs[@]} \) "${EXCLUDE_FIND_ARGS[@]}" -print0 \
    | xargs -0 sed_inplace "${subs[@]}" || true

  # Update root package.json workspaces array entries.
  log "  Updating root package.json workspaces.packages"
  for pkg in "${SURVIVING_PACKAGES[@]}"; do
    local new="${pkg/twenty-/exe-crm-}"
    sed_inplace "s|\"packages/${pkg}\"|\"packages/${new}\"|g" package.json
  done
  sed_inplace 's|"packages/create-twenty-app"|"packages/create-exe-crm-app"|g' package.json

  log "Phase 3 done. Run: yarn install && yarn build && yarn test"
}

# ---------------------------------------------------------------------------
# Phase 4: Docker / helm config
# ---------------------------------------------------------------------------

phase4_docker_helm() {
  log "Phase 4: Docker + helm specific edits (image names, service names, DB user)"
  cd "${REPO_ROOT}"

  local docker_dir="packages/exe-crm-docker"
  if [ ! -d "${docker_dir}" ]; then
    warn "${docker_dir} not found — phase 2 may not have run yet."
    return 0
  fi

  # Docker compose service/image/db substitutions live here. Phase 3 catches
  # most of these, but compose files often have container_name / DB user
  # that need explicit treatment.
  for f in "${docker_dir}"/docker-compose.yml \
           "${docker_dir}"/docker-compose.dev.yml \
           "${docker_dir}"/podman/podman-compose.yml; do
    [ -f "$f" ] || continue
    log "  Rewriting docker compose: $f"
    sed_inplace \
      -e 's|container_name: twenty|container_name: exe-crm|g' \
      -e 's|POSTGRES_DB: twenty|POSTGRES_DB: exe_crm|g' \
      -e 's|POSTGRES_USER: twenty|POSTGRES_USER: exe_crm|g' \
      -e 's|twentycrm/twenty|askexe/exe-crm|g' \
      "$f"
  done

  # Helm Chart.yaml chart name
  local chart="${docker_dir}/helm/exe-crm/Chart.yaml"
  if [ -f "${chart}" ]; then
    log "  Updating helm Chart.yaml chart name"
    sed_inplace 's|^name:[[:space:]]*twenty$|name: exe-crm|' "${chart}"
  fi

  log "Phase 4 done. Validate: docker compose -f ${docker_dir}/docker-compose.yml config"
}

# ---------------------------------------------------------------------------
# Verify: grep for residual twenty-* references that should have been rewritten
# ---------------------------------------------------------------------------

phase_verify() {
  log "Verify: scanning for residual twenty-* references in source files"
  cd "${REPO_ROOT}"

  local hits
  # shellcheck disable=SC2068
  hits=$(find . -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
       -o -name '*.json' -o -name '*.yaml' -o -name '*.yml' \) \
    "${EXCLUDE_FIND_ARGS[@]}" \
    -exec grep -lE 'twenty-(front|server|emails|ui|utils|zapier|e2e-testing|shared|sdk|client-sdk|apps|cli|oxlint-rules|companion|docker)' {} + 2>/dev/null \
    | sort -u || true)

  if [ -n "${hits}" ]; then
    warn "Residual twenty-* references found in:"
    echo "${hits}" | sed 's/^/  /'
    return 1
  fi
  log "Verify clean — no residual twenty-* package references."
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

case "${1:-}" in
  phase1)  phase1_delete_marketing ;;
  phase2)  phase2_rename_directories ;;
  phase3)  phase3_rewrite_imports ;;
  phase4)  phase4_docker_helm ;;
  verify)  phase_verify ;;
  all)
    phase1_delete_marketing
    phase2_rename_directories
    phase3_rewrite_imports
    phase4_docker_helm
    phase_verify
    ;;
  *)
    cat <<EOF
Usage: $0 {phase1|phase2|phase3|phase4|verify|all}

  phase1   Delete marketing subpackages (twenty-docs, twenty-website,
           twenty-website-new) and remove from workspaces / oxlint scope rules.
  phase2   git mv surviving package directories twenty-* -> exe-crm-*.
           REQUIRED: run 'yarn install' before phase3 to refresh node_modules.
  phase3   Rewrite import paths, package.json names, tsconfig mappings,
           workspace globs across the repo.
           REQUIRED: run 'yarn install && yarn build && yarn test' after.
  phase4   Docker compose / Dockerfile / helm chart specific edits
           (container_name, POSTGRES_DB/USER, image names, chart name).
  verify   Scan for residual twenty-* references that should have been rewritten.
  all      Run phase1..phase4 + verify in sequence (NOT recommended without
           interactive yarn install/build between phases).

Read scripts/rebrand/README.md for the full runbook.
EOF
    exit 1
    ;;
esac
