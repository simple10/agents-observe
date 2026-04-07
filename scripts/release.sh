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

# Find the previous tag for git log range
PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -z "$PREV_TAG" ]; then
  echo "Warning: no previous tag found, changelog will cover full history"
  LOG_RANGE="HEAD"
else
  LOG_RANGE="${PREV_TAG}..HEAD"
fi

echo "=== Releasing $TAG (previous: ${PREV_TAG:-none}) ==="

# ── Generate changelog ──────────────────────────────────

echo ""
echo "=== Generating changelog entry ==="

COMMIT_LOG=$(git log "$LOG_RANGE" --oneline --no-decorate)
COMMIT_COUNT=$(echo "$COMMIT_LOG" | wc -l | tr -d ' ')
echo "Found $COMMIT_COUNT commits since $PREV_TAG"

# Use Claude to write the changelog entry
CHANGELOG_ENTRY=$(claude -p "$(cat <<PROMPT
Write a CHANGELOG.md entry for version $VERSION of agents-observe.

Here are the commits since the last release ($PREV_TAG):

$COMMIT_LOG

Rules:
- Start with: ## $TAG — <one-line summary of the release theme>
- Below the header, write a 2-3 sentence summary paragraph highlighting the major features or fixes in this release. Keep it concise and user-facing.
- If there are breaking changes, add a ### Breaking Changes section immediately after the summary with clear migration instructions.
- Then group changes under headings: ### Features, ### Fixes, ### Other (omit empty groups)
- Each item is a single concise line in user-facing language (not commit messages — rewrite for clarity)
- Collapse related commits into one item (e.g. 5 README updates = one "Updated documentation" line)
- Keep the ### Other section short — combine minor changes (docs updates, refactors, config tweaks) into 2-3 combined bullet points rather than listing each one individually
- Do NOT include commit SHAs, author names, or dates on individual items
- Do NOT include the release: commit itself
- Do NOT include a top-level # Changelog header — only the ## version entry and its contents
- Ensure valid markdown: blank line before and after headings, consistent list indentation, no trailing whitespace
- Output ONLY the markdown entry, no preamble or explanation
PROMPT
)" 2>/dev/null)

if [ -z "$CHANGELOG_ENTRY" ]; then
  echo "Error: Claude failed to generate changelog entry"
  echo "You can write it manually in CHANGELOG.md and re-run"
  exit 1
fi

# Insert new entry below the # Changelog header (create file if needed)
if [ -f CHANGELOG.md ]; then
  # Extract everything after the first header line
  BODY=$(sed '1{/^# /d;}' CHANGELOG.md | sed '/./,$!d')
  printf '# Changelog\n\n%s\n\n%s\n' "$CHANGELOG_ENTRY" "$BODY" > CHANGELOG.md
else
  printf '# Changelog\n\n%s\n' "$CHANGELOG_ENTRY" > CHANGELOG.md
fi

echo ""
echo "Draft changelog entry:"
echo "─────────────────────────────────"
echo "$CHANGELOG_ENTRY"
echo "─────────────────────────────────"

# Open in editor for review
EDITOR="${VISUAL:-${EDITOR:-vi}}"
echo ""
echo "Opening CHANGELOG.md in $EDITOR for review..."
echo "Save and close when done. Ctrl-C to abort the release."
"$EDITOR" CHANGELOG.md

# Verify the new version appears in CHANGELOG.md
if ! grep -q "## $TAG" CHANGELOG.md; then
  echo "Error: CHANGELOG.md does not contain an entry for $TAG"
  echo "The entry must include a line starting with: ## $TAG"
  exit 1
fi

echo "Changelog entry for $TAG confirmed."

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
