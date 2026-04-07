#!/usr/bin/env bash
# Release script for agents-observe.
# Bumps version, generates changelog via Claude, opens editor for review,
# then commits, tags, and pushes.
#
# Usage: scripts/release.sh [--dry-run] <version>
#   e.g.  scripts/release.sh 0.8.0
#         scripts/release.sh --dry-run 0.8.0

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

DRY_RUN=false
VERSION=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) VERSION="$arg" ;;
  esac
done

if [ -z "$VERSION" ]; then
  echo "Usage: scripts/release.sh [--dry-run] <version>  (e.g. 0.8.0)"
  exit 1
fi

# Normalize: strip leading "v", then build tag
VERSION="${VERSION#v}"
TAG="v${VERSION}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists"
  exit 1
fi

if ! $DRY_RUN && [ -n "$(git status --porcelain)" ]; then
  echo "Error: working directory is not clean — commit or stash changes first"
  exit 1
fi

# Make sure all hooks are properly configured in the hooks files
echo ""
if bun run ./scripts/check-hooks.ts; then
  echo "All hooks properly configured"
else
  echo "Fix the hooks before releasing"
  exit 1
fi

echo "=== Releasing $TAG ==="

# ── Generate changelog ──────────────────────────────────

scripts/generate-changelog.sh "$VERSION"

# ── Bump versions ────────────────────────────────────────

echo ""
echo "Bumping version to $VERSION..."

# VERSION file (source of truth for server + CLI)
echo "$VERSION" > VERSION

# package.json (root)
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json

# .claude-plugin/plugin.json (static manifest — can't read files)
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" .claude-plugin/plugin.json

# ── Test and build ───────────────────────────────────────

echo ""
echo "=== Running tests ==="
npm test

echo ""
echo "=== Building Docker image ==="
docker build -t agents-observe:local .

echo ""
echo "=== Running fresh install test ==="
scripts/test-fresh-install.sh --skip-build

if $DRY_RUN; then
  echo ""
  echo "=== Dry run complete ==="
  echo "Changelog, version bumps, tests, and Docker build all passed."
  echo "Modified files (not committed):"
  git status --short
  echo ""
  echo "To finish the release, revert changes and run without --dry-run:"
  echo "  git checkout -- VERSION package.json .claude-plugin/plugin.json CHANGELOG.md"
  echo "  scripts/release.sh $VERSION"
  exit 0
fi

# ── Commit, tag, push ────────────────────────────────────

echo ""
echo "Committing release..."
git add VERSION package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "release: v${VERSION}"

echo "Tagging $TAG..."
git tag "$TAG"

echo "Pushing to origin..."
git push origin main "$TAG"

echo ""
echo "=== Released $TAG ==="
echo "GitHub Actions will build the Docker image and create the GitHub release."
echo "Watch: https://github.com/simple10/agents-observe/actions"
