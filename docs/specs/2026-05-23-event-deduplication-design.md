# Event Deduplication Design

**Date:** 2026-05-23
**Status:** Proposed

## Problem

When multiple plugins or hooks fire the same event, the server records duplicates. Concretely: running `claude` in this repo with the `agents-observe` plugin also installed globally causes every hook to fire twice. The two requests hit `/events` milliseconds apart with byte-identical payloads — only the envelope `timestamp` (client-stamped) and `created_at` (server-stamped) differ. Example: events `219220` and `219221` in the local dev DB, 11 ms apart, identical 2061-byte payload, identical `_meta`, identical `cwd`, identical `session_id` / `agent_id` / `hook_name`.

This is misconfiguration, not a server bug. But it's also realistic — users can plausibly install the plugin globally while working in this repo, and in future a separate local event aggregator might forward the same events. The server should defend against it.

## Goals

- Drop forward duplicate events for the same logical hook firing from any source.
- Be safe under rapid-fire (sub-second) and slower (multi-second) duplicates within a reasonable window.
- Make the ingestion endpoint **idempotent** for the duplicate window — same envelope in, same `event.id` out.
- Cost essentially zero on the happy path (one hash, one indexed lookup).
- Leave room for future "replay events from a journal" tooling to use the same dedup path without extra work.

## Non-goals

- Backfilling dedup for the existing ~219k events. Forward-looking only.
- Detecting "logically equivalent but textually different" events (e.g., same tool call with different `tool_use_id`). If payloads differ at all in content, they're separate events.
- Cross-server / distributed dedup. Single-server scope.

## Design

### Signature hash

For each incoming event, compute:

```
signature_hash = sha256_hex(canonical_json({
  session_id,
  agent_id,
  hook_name,
  cwd,
  payload,
  _meta,
  flags,
  ts_bucket: Math.floor(timestamp / 5000)
}))
```

Where `canonical_json` recursively sorts object keys and emits compact (no-whitespace) JSON, so equivalent objects with different key orders hash identically.

Field choices:

- **`session_id`, `agent_id`, `hook_name`, `cwd`** — the "where this happened" context. Always present (or normalized to `null`) on the envelope today.
- **`payload`, `_meta`** — the actual hook content. `_meta` does not currently contain a timestamp; if that ever changes, that field must be stripped before hashing.
- **`flags`** — included so two clients that disagree on `stopsSession` / `startsNotification` / `clearsNotification` produce distinct hashes. Defends against subtle client-version drift.
- **`ts_bucket`** — `floor(timestamp / 5000)`. Quantizes the envelope timestamp into 5-second buckets. Two identical events <5s apart land in the same bucket (collide → dedupe). Two identical events ≥5s apart land in different buckets (do not dedupe → treated as separate real events).

The envelope `timestamp` is the top-level optional field already parsed by `parser.ts` (falling back to `Date.now()` when absent). We use the same value `validateEnvelope` returns, after its existing future-clamp logic.

### Boundary case

Events that straddle a 5-second boundary (e.g., one at `…04.999`, the next at `…05.001`) land in adjacent buckets and won't dedupe. Given the observed drift between dupes is ~11 ms, this is a ~0.4% worst-case miss rate — acceptable for defense-in-depth. We do not implement overlapping-bucket lookups; the cost of the missed dedup is one extra row, not data loss.

### Schema

```sql
ALTER TABLE events ADD COLUMN signature_hash TEXT;
CREATE UNIQUE INDEX idx_events_signature_hash ON events(signature_hash);
```

- Existing rows have `signature_hash = NULL`. SQLite treats NULLs as distinct under UNIQUE, so the 219k+ historical rows don't conflict with each other or with new rows.
- UNIQUE on `signature_hash` alone (not `(session_id, signature_hash)`) because `session_id` is already inside the hashed payload — different sessions produce different hashes for otherwise-identical envelopes.

### Request flow (changes in `app/server/src/routes/events.ts`)

After envelope validation (`validateEnvelope`) and before the session upsert (step 2 in the existing comment), insert a new step:

1. **Compute** `signature_hash` from the validated envelope + bucketed timestamp.
2. **Pre-check:** `SELECT id FROM events WHERE signature_hash = ? LIMIT 1`.
3. **Hit:** respond `201 { id: <existing>, deduplicated: true }`. Skip all remaining steps — session/agent/project upserts, event insert, flag application, broadcast. The original event already did this work.
4. **Miss:** proceed with the existing pipeline. Pass `signature_hash` into `store.insertEvent`.
5. **Race safety:** if the INSERT raises SQLite's `SQLITE_CONSTRAINT_UNIQUE` (two concurrent identical requests both passed the pre-check), catch it, re-`SELECT` by hash, return that row's id with `deduplicated: true`. Same response shape as the hit path.

### Response shape

- Fresh insert: `201 { id }` (unchanged from today) or `201 { id, requests: [...] }` when callbacks are needed (unchanged).
- Duplicate: `201 { id, deduplicated: true }`.

Both use `201`. The CLI today reads `body.requests` and `body.systemMessage` only; status code and the new `deduplicated` flag are non-breaking. Dashboard / API consumers that want to count dedup hits can read the new field.

### Logging

Log dedup hits at `info` (one line, not debug, not trace):

```
[dedup] hook=PostToolBatch session=5faf...4e73 orig_event_id=219220
```

This makes misconfigurations visible without a tracing harness. At dashboard scale, a few hits per session is normal noise; thousands per session is a flag.

### Storage adapter changes (`app/server/src/storage/sqlite-adapter.ts`)

1. Schema bootstrap: add the column and unique index alongside the existing `events` table setup. Guard with `PRAGMA table_info` check, matching the pattern already used for `created_at`, `hook_name`, etc.
2. `insertEvent`: accept an optional `signatureHash` field on `InsertEventParams`. Include it in the INSERT statement.
3. New method: `findEventBySignatureHash(hash: string): Promise<{ id: number } | null>`. Single indexed lookup.
4. Surface SQLite's UNIQUE constraint error in a way the route handler can catch and convert into the dedup path. Either re-throw a typed error (`UniqueViolationError`) or return a sentinel result from `insertEvent`. Typed error is cleaner.

### Storage types (`app/server/src/storage/types.ts`)

Add `signatureHash?: string` to `InsertEventParams`. Add `findEventBySignatureHash` to the `EventStore` interface.

## Replay note (future)

Replay tooling will need to preserve the envelope `timestamp` (or any value within 5s of the original) on the replayed request so the bucket matches. A naive journal that timestamps replays at "now" will not dedupe against the original. This is by design — replays from days later are arguably new events. When the replay tool lands, it should pass through the original timestamp.

## Testing

- **Unit:** canonical-JSON helper produces identical strings for objects with reordered keys, including nested objects and arrays-of-objects.
- **Unit:** `signature_hash` stable across payload key reorderings; differs when any hashed field changes (including `flags`).
- **Unit:** `ts_bucket = floor(ts / 5000)` — table of cases including the boundary.
- **Integration:** POST same envelope twice → second returns `201 { id: <same>, deduplicated: true }`; only one row in `events`.
- **Integration:** POST same envelope twice, second envelope's `timestamp` 6 seconds later → both insert (different buckets), distinct ids.
- **Integration:** POST same envelope with `payload` keys reordered → still dedupes.
- **Integration:** Concurrent POST of identical envelopes (simulate via `Promise.all`) → exactly one row inserted, both responses return that row's id.
- **Integration:** Dedup path does NOT re-broadcast on the websocket and does NOT re-apply flags (e.g., does not double-stamp `pending_notification_ts`).

## Rollout

1. Schema migration runs on server start (additive — column nullable, no backfill).
2. Existing rows keep `signature_hash = NULL`; new rows compute it.
3. No client-side changes required for the CLI, dashboard, or external consumers.
4. Reversible: dropping the column and index reverts behavior. No data loss.

## Open questions

None blocking. Future enhancements (not in scope for this spec):

- Surface a per-session dedup counter in the dashboard so users can see misconfigurations.
- If we later see legitimate identical payloads within 5s in real hook traffic, revisit the bucket size or add a discriminator field.
