# OpenClaw Update Notification System — Design Spec

## Context

OpenClaw is a Claude Code plugin ecosystem. Each plugin includes an MCP server that serves a dashboard UI. This spec defines a system for the dashboard to notify users when their installed version is out of date, with severity-aware messaging (e.g., security vulnerability vs. routine update).

## Problem

Users running older versions of OpenClaw plugins have no visibility into whether updates are available or whether their current version has known security issues. The dashboard is the natural place to surface this, but we need a structured approach that goes beyond "new version available" — the UI should communicate *urgency* and *relevance* based on what changed between the user's version and the latest.

## Goals

1. The dashboard periodically checks a canonical manifest file hosted in the GitHub repo for version/release metadata.
2. The UI compares the user's current version against the manifest and filters to relevant releases.
3. Notifications are severity-tiered: security vulnerabilities surface as critical alerts; breaking changes as warnings; routine updates as passive nudges.
4. The manifest format is easy to maintain by hand and doesn't require a build step or CI integration to update.
5. The system is read-only from the client's perspective — no telemetry, no phone-home beyond fetching the manifest.

## Non-Goals

- Auto-updating or self-patching plugins.
- A package registry or distribution system.
- Beta/release channels (defer until needed).
- Server-side version tracking or user analytics.

## Architecture Overview

```
GitHub Repo                        Dashboard UI
┌──────────────────┐               ┌──────────────────────────┐
│ updates.json     │──── fetch ───▶│ Version comparison logic │
│ (raw.github...)  │               │ Notification renderer    │
└──────────────────┘               └──────────────────────────┘
        │                                     │
        ▼                                     ▼
  Optional: CF Worker               Severity-tiered banner
  (cache control proxy)             with expandable details
```

## Manifest Format

The manifest lives at a stable path in the repo (e.g., `updates.json` at root or in a `.openclaw/` directory). It is the single source of truth for release metadata.

### Schema

```jsonc
{
  // The latest stable version
  "latest": "0.4.2",

  // Oldest version that still receives passive "update available" treatment.
  // Anything below this gets a hard "unsupported" warning.
  "minimum_supported": "0.3.0",

  // Ordered newest-first
  "releases": [
    {
      "version": "0.4.2",
      "date": "2025-04-05",

      // Severity level for this release. Drives UI treatment.
      //   "security"  — patches a known vulnerability
      //   "breaking"  — contains breaking changes requiring migration
      //   "feature"   — new functionality, non-breaking
      //   "fix"       — bug fix, non-breaking
      "severity": "security",

      // One-line summary shown in the notification banner
      "summary": "Fixes auth bypass in MCP session validation",

      // Markdown body rendered when the user expands the notification.
      // Keep concise — this is not a full changelog.
      "details_md": "### Security Fix\n\nPatches an issue where...",

      // Urgency hint for the UI. Maps to visual treatment:
      //   "critical" — red banner, cannot be dismissed without acknowledging
      //   "high"     — orange/amber banner, dismissible but persistent
      //   "normal"   — blue/subtle banner, dismissible
      "upgrade_urgency": "critical",

      // Whether upgrading to this version requires migration steps
      "breaking": false,

      // Optional URL to migration guide (only relevant if breaking: true)
      "migration_url": null
    }
  ]
}
```

### Manifest Maintenance Rules

- New releases are prepended to the `releases` array (newest first).
- Old releases can be pruned once they fall below `minimum_supported`, but keeping ~10 recent entries is fine.
- `latest` and `minimum_supported` are updated manually alongside the releases array.
- The file is committed to the repo alongside the release — no CI required.

## Client Behavior

### Fetching

- **Source URL**: `https://raw.githubusercontent.com/{org}/{repo}/{branch}/updates.json`
- **Frequency**: On dashboard load, then every 30 minutes while the dashboard is open. Use a simple `setInterval` — no need for service workers or background sync.
- **Caching**: `raw.githubusercontent.com` has ~5 min edge caching. This is acceptable. If faster propagation is needed later, introduce a lightweight Cloudflare Worker proxy that fetches via the GitHub API (which respects `Cache-Control` headers).
- **Failure handling**: If the fetch fails (network error, 404, malformed JSON), silently skip — never block the dashboard or show an error for this. Log to console for debugging.

### Version Comparison

- Use [semver](https://www.npmjs.com/package/semver) for comparison, or a minimal inline comparator if bundle size is a concern (~20 lines for `major.minor.patch` comparison).
- The user's current version comes from the plugin's own metadata (e.g., `package.json` version baked into the build, or exposed via an MCP resource).

### Notification Logic

Given the user's current version `V`:

1. **Unsupported**: If `V < minimum_supported` → show a persistent, non-dismissible warning that this version is no longer supported. Link to latest release.

2. **Up to date**: If `V >= latest` → show nothing (or optionally a subtle "up to date" indicator).

3. **Update available**: If `minimum_supported <= V < latest`:
   a. Filter `releases` to entries where `entry.version > V` (all releases newer than the user's version).
   b. Determine the **worst severity** across the filtered set:
      - If any entry has `severity: "security"` → treat the entire notification as critical.
      - Else if any has `severity: "breaking"` → treat as high.
      - Else → treat as normal.
   c. Determine the **worst urgency** similarly (take the max of `upgrade_urgency` across filtered entries).
   d. Render a notification banner matching the derived urgency tier.

### Notification UI Tiers

| Urgency | Visual Treatment | Dismissible? | Content |
|---------|-----------------|--------------|---------|
| `critical` | Red banner, top of dashboard | Yes, but reappears on next load | Summary of security issue + upgrade command |
| `high` | Amber banner | Yes, stays dismissed for session | Summary of breaking change + migration link |
| `normal` | Subtle blue/gray banner or badge | Yes, stays dismissed for session | "Version X.Y.Z available" + summary |
| Unsupported | Red banner, non-dismissible | No | "This version is no longer supported" |

### Expanded View

Clicking the banner or a "Details" link expands to show:
- A list of all releases between the user's version and latest.
- Each entry shows version, date, severity badge, and the rendered `details_md`.
- If any entry has `breaking: true`, highlight the migration link prominently.

### Dismiss Behavior

- Dismissals are stored in local state (localStorage or equivalent) keyed by the version that was shown.
- If a *new* version appears in the manifest that wasn't in the previous check, the banner reappears even if the user dismissed a prior notification.
- Critical/security notifications reappear on every dashboard load regardless of dismissal.

## Implementation Notes

### Where the Current Version Comes From

The plugin's current version should be available to the dashboard without an extra fetch. Options:
- Baked into the dashboard build as a constant (e.g., `__OPENCLAW_VERSION__`).
- Exposed as an MCP resource that the dashboard reads on init.
- Injected into the dashboard HTML by the MCP server at serve time.

Pick whichever aligns with the existing plugin build/serve pipeline.

### Optional: Cloudflare Worker Proxy

If GitHub's raw CDN caching becomes a problem (e.g., you publish a security fix and need it visible immediately), add a Worker at something like `updates.openclaw.dev` that:
- Fetches from `api.github.com/repos/{org}/{repo}/contents/updates.json` (which respects ETags).
- Caches in KV or the Cache API with a short TTL (e.g., 60s).
- Returns the decoded JSON.

This is a nice-to-have, not a launch requirement.

### Security Considerations

- The manifest is fetched over HTTPS from a known origin. No authentication required since it's public.
- The `details_md` field is rendered as Markdown in the UI. Sanitize the rendered HTML to prevent XSS — use a safe Markdown renderer (e.g., `marked` with `sanitize: true`, or `DOMPurify` on the output).
- Never `eval()` or execute anything from the manifest.

## Open Questions

1. **Manifest location**: Root of repo (`updates.json`) vs. a subdirectory (`.openclaw/updates.json`) vs. a dedicated branch? Root is simplest.
2. **Multi-plugin support**: If OpenClaw grows to have multiple independently-versioned plugins, does each plugin get its own manifest, or is there a single manifest with a `plugin` field per release? Start with single-plugin and add the field later if needed.
3. **Changelog integration**: Should `details_md` duplicate the changelog, or should releases just link to the GitHub release page? Keeping a short summary in `details_md` and linking out for full details is probably the right balance.
4. **Notification persistence**: Should the dashboard remember dismissed notifications across sessions (localStorage) or only for the current session (in-memory)? localStorage keyed by version is recommended.

## Success Criteria

- A user on an outdated version sees a clear, appropriately-urgent notification within seconds of opening the dashboard.
- A user on a version with a known security issue sees a critical alert that cannot be permanently dismissed.
- A user on the latest version sees no notification noise.
- Maintainers can publish update metadata by editing a single JSON file — no CI, no build step, no deploy.
