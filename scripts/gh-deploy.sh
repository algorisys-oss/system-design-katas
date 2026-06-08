#!/usr/bin/env bash
set -euo pipefail

#
# gh-deploy.sh — Deploy the static site to GitHub Pages of the OSS repo:
#   https://github.com/algorisys-oss/system-design-katas  ->  gh-pages branch
#   served at https://algorisys-oss.github.io/system-design-katas/
#
# This is a thin wrapper over scripts/publish-gh-pages.sh that targets the OSS
# remote instead of origin. The gh-pages branch holds ONLY the built static site
# (SPA bundle + pre-rendered content/use-cases JSON) — no source, no CLAUDE.md /
# plan.md / internal artifacts — so the deployed site is inherently LLM-free.
#
# Usage:
#   ./scripts/gh-deploy.sh            # build + deploy to the OSS gh-pages branch
#   ./scripts/gh-deploy.sh --build    # build only (preview locally, no push)
#
# Requirements: run locally with the zen-ui clone built (the frontend aliases its
# dist/) — CI can't, since zen-ui isn't on npm. Override its path with ZEN_UI_DIST.
#
# Config (env, with OSS defaults):
#   OSS_PAGES_REMOTE  default https://github.com/algorisys-oss/system-design-katas.git
#   PAGES_BASE        default /system-design-katas/   (org project-page subpath)
#   PAGES_BRANCH      default gh-pages
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

OSS_PAGES_REMOTE="${OSS_PAGES_REMOTE:-https://github.com/algorisys-oss/system-design-katas.git}"
export PAGES_REMOTE="$OSS_PAGES_REMOTE"
export PAGES_BASE="${PAGES_BASE:-/system-design-katas/}"
export PAGES_BRANCH="${PAGES_BRANCH:-gh-pages}"

echo "▸ gh-deploy → OSS GitHub Pages"
echo "  remote : $PAGES_REMOTE"
echo "  branch : $PAGES_BRANCH"
echo "  base   : $PAGES_BASE"
echo "  URL    : https://algorisys-oss.github.io${PAGES_BASE}"
echo

# Delegate the build + force-push to the shared pipeline.
"$SCRIPT_DIR/publish-gh-pages.sh" "$@"

if [[ "${1:-}" != "--build" ]]; then
  echo
  echo "▸ One-time setup on the OSS repo:"
  echo "  GitHub → algorisys-oss/system-design-katas → Settings → Pages →"
  echo "  Source = branch '$PAGES_BRANCH', folder / (root)."
  echo "  Live at: https://algorisys-oss.github.io${PAGES_BASE}"
fi
