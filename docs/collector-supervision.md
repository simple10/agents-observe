# Collector Supervision

The **collector** is a long-lived Node process that receives hook events and keeps
them flowing to the dashboard. Supervision exists to guarantee one property:

> **Exactly one healthy collector per data root — no duplicates, no silent absence.**

This document is the contract. The primitives that implement it live in
`hooks/scripts/supervision/lib/`; the read-only diagnostic is
`hooks/scripts/supervision/observe-health.sh`.

> **Status:** these are supervision primitives only. Nothing in the hook, the CLI,
> or the server calls them yet — event delivery is unchanged. Wiring the collector
> and the supervisor on top of them is later work.

## Vocabulary

| Term            | Meaning                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| **collector**   | The long-lived process being supervised. It stays alive; exiting is a fault.      |
| **data root**   | One supervised instance's namespace. `AGENTS_OBSERVE_DATA_ROOT`.                  |
| **instance id** | Identifies one collector *run*. Restarting produces a new instance id.            |
| **heartbeat**   | A record the collector republishes to prove it is still working, not just alive.  |
| **lock**        | A directory whose existence + recorded identity make the singleton claim true.    |

## Runtime layout

Everything supervision owns lives under the data root, so two data roots can never
touch each other's state:

```
$AGENTS_OBSERVE_DATA_ROOT/runtime/
  collector.lock/            singleton lock, held for the collector's whole life
    pid                      recorded owner PID; creating it is the claim
    pid-identity             PID + process start time + executable
    executable               resolved executable path
    entrypoint               stable entrypoint marker expected in the command line
    data-root                the data root this lock belongs to
    instance-id              this collector run
    started-at               epoch seconds the lock was claimed
  collector-start.lock/      held only across a start attempt
  collector.heartbeat        instanceId / pid / updatedAt
  collector-lifecycle.log    append-only diagnostic ledger
```

`AGENTS_OBSERVE_DATA_ROOT` falls back to `AGENTS_OBSERVE_LOCAL_DATA_ROOT` (the data
dir override `hooks/scripts/lib/config.mjs` already reads) and then to
`~/.agents-observe`, so supervision state lands beside the database by default
instead of in a second location.

## Configuration

| Variable                            | Default                    | Purpose                                     |
| ----------------------------------- | -------------------------- | ------------------------------------------- |
| `AGENTS_OBSERVE_DATA_ROOT`          | see above                  | The supervised instance's namespace         |
| `AGENTS_OBSERVE_HEALTH_GRACE`       | `30`                       | Heartbeat freshness window, seconds         |
| `AGENTS_OBSERVE_START_TIMEOUT`      | `15`                       | Wait for a new collector to confirm, seconds|
| `AGENTS_OBSERVE_START_POLL`         | `0.2`                      | Poll interval while confirming, seconds     |
| `AGENTS_OBSERVE_ENTRYPOINT_MARKER`  | `agents-observe-collector` | Stable marker expected in the command line  |
| `AGENTS_OBSERVE_HEALTH_URL`         | *(empty)*                  | HTTP health endpoint; empty = leg skipped   |
| `AGENTS_OBSERVE_LOCK_SETTLE`        | `2`                        | Grace for a lock still being written, seconds|
| `AGENTS_OBSERVE_PROC_ROOT`          | `/proc`                    | Where process identity is read from         |

## Invariants

**1. A PID is never proof of ownership.**
PIDs get reused. Ownership requires the recorded identity — PID + process start
time + executable — to still match the live process, *and* the live process to
carry the recorded entrypoint marker. The marker is deliberately not the full
command line: argv changes across restarts, and matching it whole would make every
ordinary restart look like an impostor.

**2. Locks are claimed atomically, in two stages.**
`mkdir` creates the lock directory — mkdir(2) either creates or fails with EEXIST,
with no window in between, and stays atomic over NFS and most shared filesystems.
The owner is then claimed by creating `pid` under `set -C` (noclobber), which makes
bash itself open the file with `O_CREAT|O_EXCL`. Exactly one process wins that.
There is no check-then-write path anywhere in the kernel.

The second stage is not belt-and-braces. `mkdir` is whatever `/usr/bin/mkdir` the
host ships, and that is not always race-correct: Ubuntu 25.10's uutils coreutils
0.8.0 `mkdir` reports **success to several concurrent creators of the same
directory** (the identical race under perl's `mkdir(2)`, or under the noclobber
write, has exactly one winner). A singleton guarantee that rests on the host's
`mkdir` binary is not a guarantee. Stage 2 runs inside bash, so correctness does
not depend on any external binary.

**3. Age is never evidence of abandonment.**
A lock is abandoned only when its owner is *provably* gone: no usable PID, a dead
PID, or a live PID whose identity no longer matches. A healthy collector that has
been up for a week holds a week-old lock; reclaiming it for looking old would kill
the thing the lock protects.

**4. Fresh is not enough — it has to be ours.**
The heartbeat carries the same `instanceId` as the lock. A fresh heartbeat from a
*different* instance is not health; it means two collectors are alive in one data
root, and it is reported as an ownership error rather than quietly accepted.

**5. Signals are addressed by identity, never by pattern.**
`observe_signal_locked_process` re-verifies the lock's identity before it delivers
anything. There is no `pkill -f` path: a pattern match would hit every data root's
collector on the machine, not just this one's.

**6. Data roots are isolated.**
Every runtime path is derived from the selected data root. Unsafe roots (empty,
relative, `/`, containing `..`, or containing a newline or tab) are rejected before
any path is built.

**7. The diagnostic never mutates.**
`observe-health.sh` reads and reports. It does not signal, reclaim, repair, or even
create the runtime directory — a diagnostic that mutates changes the answer it was
asked to report.

## Health predicate

The collector is healthy when **all** of these hold:

1. the lock exists, and
2. it belongs to this data root, and
3. its recorded PID is alive, and
4. the live process identity matches the recorded identity, and
5. the live process carries the recorded entrypoint marker, and
6. the heartbeat's `instanceId` matches the lock's, and
7. the heartbeat is within the grace window, and
8. the HTTP health check succeeds — when one is configured.

The HTTP leg is currently unconfigured, so it reports `skipped` and does not fail
health. Setting `AGENTS_OBSERVE_HEALTH_URL` turns it on with no API change.

## Diagnostic output

```
$ hooks/scripts/supervision/observe-health.sh
collector: healthy pid=48213 heartbeat=3s http=ok
collector: absent
collector: unhealthy reason=stale-heartbeat pid=48213
collector: invalid-owner reason=pid-identity-mismatch pid=48213
```

| Exit | Meaning                                                                    |
| ---- | -------------------------------------------------------------------------- |
| `0`  | Healthy.                                                                   |
| `1`  | Absent or unhealthy. A supervisor may start or restart the collector.      |
| `2`  | Invalid configuration, or an unsafe ownership state — do **not** act blindly.|

Reasons, and why each lands where it does:

| Status          | Reason                  | Exit | Meaning                                              |
| --------------- | ----------------------- | ---- | ---------------------------------------------------- |
| `unhealthy`     | `dead-pid`              | 1    | Owner went away; the lock is reclaimable.            |
| `unhealthy`     | `missing-heartbeat`     | 1    | Process is up but has never reported working.        |
| `unhealthy`     | `stale-heartbeat`       | 1    | Process is up but wedged.                            |
| `unhealthy`     | `http-unhealthy`        | 1    | Process and heartbeat fine, endpoint is not.         |
| `invalid-owner` | `data-root-mismatch`    | 2    | The lock belongs to a different namespace.           |
| `invalid-owner` | `malformed-lock`        | 2    | No usable PID or identity recorded.                  |
| `invalid-owner` | `pid-identity-mismatch` | 2    | PID reuse — that PID is now somebody else.           |
| `invalid-owner` | `entrypoint-mismatch`   | 2    | Alive, but not the collector.                        |
| `invalid-owner` | `instance-mismatch`     | 2    | Heartbeat and lock disagree — two collectors.        |

## Portability

Process identity prefers `/proc` on Linux and WSL: field 22 of `/proc/<pid>/stat`
is the start time in clock ticks since boot, which — unlike a formatted wall-clock
date — does not re-render when the host clock steps and falsely evict a live
collector. Where `/proc` is absent or unreadable (macOS), identity falls back to
bounded `ps` output under `LC_ALL=C`; the locale pin matters because an identity is
written under one locale and re-read under whatever is ambient later. `/proc` is
always probed, never assumed.
