#!/usr/bin/env bash
# Build the course as a fully static site and deploy it to the OSS repo's
# GitHub Pages (the `gh-pages` branch). No backend: the content + use-cases API
# is pre-rendered to JSON the SPA fetches.
#
#   target : https://github.com/algorisys-oss/system-design-katas  (gh-pages branch)
#   live   : https://algorisys-oss.github.io/system-design-katas/
#
# The gh-pages branch holds ONLY the built site (SPA bundle + pre-rendered JSON) —
# no source, no CLAUDE.md / plan.md / internal artifacts — so it's inherently
# LLM-free.
#
# Usage:
#   scripts/gh-deploy.sh            # build + deploy to the OSS gh-pages branch
#   scripts/gh-deploy.sh --build    # build only (preview locally, no push)
#
# Config via env:
#   PAGES_REMOTE  OSS git remote (default git@github.com:algorisys-oss/system-design-katas.git)
#   PAGES_BASE    URL subpath (default /system-design-katas/ — org project page)
#   PAGES_BRANCH  branch to publish to (default gh-pages)
#   ZEN_UI_DIST   path to zen-ui's built react dist (defaults to the sibling clone)
#
# Requirements: run locally with the zen-ui clone built (the frontend aliases its
# dist/) — CI can't, since zen-ui isn't on npm. Build it first in the clone:
# `bun run build:lib`, or set ZEN_UI_DIST.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/frontend"
DIST="$FRONTEND/dist"
PAGES_REMOTE="${PAGES_REMOTE:-git@github.com:algorisys-oss/system-design-katas.git}"
PAGES_BASE="${PAGES_BASE:-/system-design-katas/}"
PAGES_BRANCH="${PAGES_BRANCH:-gh-pages}"
BUILD_ONLY=0
[ "${1:-}" = "--build" ] && BUILD_ONLY=1

# pick a package runner
if command -v bun >/dev/null 2>&1; then RUN="bun run"; INSTALL="bun install"
else RUN="npm run"; INSTALL="npm install"; fi

echo "▸ Deploying static site to OSS GitHub Pages"
echo "  remote : $PAGES_REMOTE"
echo "  branch : $PAGES_BRANCH"
echo "  base   : $PAGES_BASE"
echo "  URL    : https://algorisys-oss.github.io${PAGES_BASE}"

# zen-ui dist sanity check (the frontend aliases it)
ZEN_DIST="${ZEN_UI_DIST:-$ROOT/../../../work/algo/zen-ui/packages/react/dist}"
if [ ! -f "$ZEN_DIST/index.js" ]; then
  echo "  ! zen-ui dist not found at: $ZEN_DIST" >&2
  echo "    Build it first (in the zen-ui clone: bun run build:lib), or set ZEN_UI_DIST." >&2
  exit 1
fi

echo "▸ Installing frontend deps (if needed)"
( cd "$FRONTEND" && [ -d node_modules ] || $INSTALL )

echo "▸ Building frontend (VITE_BASE=$PAGES_BASE, VITE_STATIC=1)"
( cd "$FRONTEND" && VITE_BASE="$PAGES_BASE" VITE_STATIC=1 $RUN build )

echo "▸ Generating static content API → dist/api"
node "$ROOT/scripts/gen-static-api.mjs" "$DIST/api"

echo "▸ Adding SPA fallback (404.html) + .nojekyll"
cp "$DIST/index.html" "$DIST/404.html"   # Pages serves 404.html → SPA boots + client-routes
touch "$DIST/.nojekyll"                    # don't run Jekyll on the output

if [ "$BUILD_ONLY" = "1" ]; then
  echo "✓ Build complete (no push). Preview with:"
  echo "    ( cd frontend && $RUN preview --base $PAGES_BASE )"
  exit 0
fi

SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
echo "▸ Force-pushing dist/ to $PAGES_BRANCH on $PAGES_REMOTE"

# Publish via a throwaway git repo in a temp dir (single commit; keeps the
# gh-pages branch tiny and never touches your working repo's git state).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -a "$DIST/." "$TMP/"
(
  cd "$TMP"
  git init -q
  git checkout -q -b "$PAGES_BRANCH"
  git add -A
  git -c user.name="publish" -c user.email="publish@local" commit -q -m "Deploy from $SHA"
  git push -f -q "$PAGES_REMOTE" "$PAGES_BRANCH"
)

echo "✓ Deployed."
echo "  One-time: in github.com/algorisys-oss/system-design-katas → Settings → Pages →"
echo "  Source = branch '$PAGES_BRANCH', folder / (root)."
echo "  Live at: https://algorisys-oss.github.io${PAGES_BASE}"
