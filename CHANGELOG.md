# Changelog

## v0.7.5 — Search polish, timeline fixes, and release tooling

No breaking changes. This version is just cosmetic improvements.

### Features

- Improved search UI with input debouncing, highlighted active border, clear button, and whitespace-only filtering
- Added cursor pointer to clickable elements in the sidebar and stream list
- Display plugin version in the sidebar and redesigned the Settings > Projects view

### Fixes

- Fixed timeline dot positioning to align correctly with trace events
- Fixed timeline animation so dots animate smoothly as a group instead of individually

### Other

- Added fresh install test harness with integration into the release workflow
- Improved release script with dry-run flag, skip-build option, and Claude-generated changelogs
- Updated contributor documentation and formatting configuration
