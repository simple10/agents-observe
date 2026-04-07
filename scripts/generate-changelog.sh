#!/usr/bin/env bash
# scripts/generate-changelog.sh
# Generates a CHANGELOG.md entry for a version using Claude.
# Can be run standalone for testing or called from release.sh.
#
# Usage:
#   scripts/generate-changelog.sh <version>
#   scripts/generate-changelog.sh 0.8.0
#
# Options:
#   --no-edit   Skip opening the editor for review

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

VERSION="${1:-}"
NO_EDIT=false
for arg in "$@"; do
  case "$arg" in
    --no-edit) NO_EDIT=true ;;
    -*) ;;
    *) VERSION="$arg" ;;
  esac
done

if [ -z "$VERSION" ]; then
  echo "Usage: scripts/generate-changelog.sh <version> [--no-edit]" >&2
  exit 1
fi

VERSION="${VERSION#v}"
TAG="v${VERSION}"

# Find the previous tag for git log range
PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -z "$PREV_TAG" ]; then
  echo "Warning: no previous tag found, changelog will cover full history"
  LOG_RANGE="HEAD"
else
  LOG_RANGE="${PREV_TAG}..HEAD"
fi

echo "=== Generating changelog entry for $TAG (since ${PREV_TAG:-beginning}) ==="

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
  echo "Error: Claude failed to generate changelog entry" >&2
  echo "You can write it manually in CHANGELOG.md and re-run" >&2
  exit 1
fi

# Insert new entry below the # Changelog header (create file if needed)
if [ -f CHANGELOG.md ]; then
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

# Open in editor for review (unless --no-edit)
if ! $NO_EDIT; then
  EDITOR="${VISUAL:-${EDITOR:-vi}}"
  echo ""
  echo "Opening CHANGELOG.md in $EDITOR for review..."
  echo "Save and close when done. Ctrl-C to abort."
  "$EDITOR" CHANGELOG.md
fi

# Verify the new version appears in CHANGELOG.md
if ! grep -q "## $TAG" CHANGELOG.md; then
  echo "Error: CHANGELOG.md does not contain an entry for $TAG" >&2
  echo "The entry must include a line starting with: ## $TAG" >&2
  exit 1
fi

echo "Changelog entry for $TAG confirmed."
