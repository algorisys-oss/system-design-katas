#!/usr/bin/env bash
# Build the course as a fully static site and publish it to the `gh-pages` branch
# for GitHub Pages. No backend: the content API is pre-rendered to JSON files.
#
# Usage:
#   scripts/publish-gh-pages.sh            # build + push to gh-pages
#   scripts/publish-gh-pages.sh --build    # build only (test locally, no push)
#
# Config via env (sensible defaults for the rajeshpillai/system-design-katas repo):
#   PAGES_BASE   URL subpath the site is served under (default /system-design-katas/)
#   PAGES_BRANCH branch to publish to            (default gh-pages)
#   ZEN_UI_DIST  path to zen-ui's built react dist (defaults to the sibling clone)
#
# Requirements: run on a machine with the zen-ui clone built (bun run build:lib),
# since the frontend aliases zen-ui's dist. CI can't do this (zen-ui isn't on npm),
# so publishing is a local step — fitting the "move to a real server later" plan.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/frontend"
DIST="$FRONTEND/dist"
PAGES_BASE="${PAGES_BASE:-/system-design-katas/}"
PAGES_BRANCH="${PAGES_BRANCH:-gh-pages}"
BUILD_ONLY=0
[ "${1:-}" = "--build" ] && BUILD_ONLY=1

# pick a package runner
if command -v bun >/dev/null 2>&1; then RUN="bun run"; INSTALL="bun install"
else RUN="npm run"; INSTALL="npm install"; fi

echo "▸ Publishing static site"
echo "  base branch : $PAGES_BRANCH"
echo "  base path   : $PAGES_BASE"
echo "  runner      : $RUN"

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

REMOTE="$(git -C "$ROOT" remote get-url origin)"
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
echo "▸ Force-pushing dist/ to $PAGES_BRANCH on $REMOTE"

# Publish via a throwaway git repo in a temp dir (single squashed commit; keeps
# the gh-pages branch tiny and never touches your working repo's git state).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -a "$DIST/." "$TMP/"
(
  cd "$TMP"
  git init -q
  git checkout -q -b "$PAGES_BRANCH"
  git add -A
  git -c user.name="publish" -c user.email="publish@local" commit -q -m "Deploy from $SHA"
  git push -f -q "$REMOTE" "$PAGES_BRANCH"
)

echo "✓ Published."
echo "  In GitHub: Settings → Pages → Source = branch '$PAGES_BRANCH', folder / (root)."
echo "  Site: https://<user>.github.io${PAGES_BASE}"
