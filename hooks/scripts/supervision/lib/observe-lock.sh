#!/usr/bin/env bash
# Atomic locking for the collector supervision kernel.
#
# Two locks, both plain directories:
#
#   collector.lock        held for the whole life of the collector. Its
#                         presence plus a matching process identity is what
#                         makes "exactly one collector per data root" true.
#   collector-start.lock  held only across a start attempt, so two supervisors
#                         racing to start a missing collector do not both fork
#                         one.
#
# A claim is made in two stages, and there is no check-then-write
# (`[ -e ] && echo >`) anywhere — that pattern has a race wide enough to drive a
# truck through.
#
#   1. `mkdir` creates the lock directory. mkdir(2) either creates or fails with
#      EEXIST, with no window in between, and stays atomic over NFS and most
#      other shared filesystems.
#   2. The owner is then claimed by creating `pid` under `set -C` (noclobber),
#      which makes bash itself open the file with O_CREAT|O_EXCL. Exactly one
#      process can win that, and the winner's PID is what the file holds.
#
# Stage 2 is not belt-and-braces. `mkdir` here is whatever `/usr/bin/mkdir` the
# host ships, and that is not always a correct one: Ubuntu 25.10's uutils
# coreutils 0.8.0 `mkdir` reports SUCCESS to several concurrent creators of the
# same directory (the same race under perl's mkdir(2), or under stage 2, has
# exactly one winner). A supervision kernel whose singleton guarantee depends on
# the host's `mkdir` binary being race-correct is not a guarantee. Stage 2 runs
# inside bash, so correctness does not depend on any external binary.
#
# A lock is ABANDONED only when its recorded process is provably gone: no
# usable PID, a dead PID, or a live PID whose identity no longer matches what
# was recorded. Age is never evidence. A healthy collector that has been up for
# a week holds a week-old lock, and reclaiming it because it "looks stale"
# would kill the very thing the lock protects.

[ -n "${OBSERVE_LOCK_SH_LOADED:-}" ] && return 0
OBSERVE_LOCK_SH_LOADED=1

# shellcheck source=hooks/scripts/supervision/lib/observe-process.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/observe-process.sh"

# Seconds a just-created lock directory is given to finish writing its owner
# files. Inside this window a lock with no PID yet is treated as live, not
# abandoned, so a competing acquirer cannot delete a lock mid-claim.
OBSERVE_LOCK_SETTLE=${AGENTS_OBSERVE_LOCK_SETTLE:-2}

OBSERVE_LOCK_FILES='pid pid-identity executable entrypoint data-root instance-id started-at'

# Stage 2 of a claim: create `pid` with O_CREAT|O_EXCL. Succeeds for exactly one
# process; every other caller sees the file already there and fails.
observe_lock_claim_pid() { # <lock-dir> <pid>
  local lockdir=${1:-} pid=${2:-}
  [ -d "$lockdir" ] || return 1
  observe_is_pid "$pid" || return 1
  # The subshell keeps noclobber from leaking into the caller's shell.
  (
    set -C
    printf '%s\n' "$pid" > "$lockdir/pid"
  ) 2>/dev/null
}

# Fill in everything the lock records besides the owning PID. Called only by the
# process that just won stage 2. The readback is not paranoia: on a full or
# read-only filesystem the writes can fail quietly enough to leave a lock whose
# owner cannot be verified later.
observe_lock_write_details() { # <lock-dir> <instance-id> <entrypoint-marker> <pid>
  local lockdir=${1:-} instance=${2:-} entrypoint=${3:-} pid=${4:-}
  local identity exe back
  [ -d "$lockdir" ] || return 1
  observe_is_pid "$pid" || return 1

  identity=$(observe_pid_identity "$pid" 2>/dev/null || true)
  [ -n "$identity" ] || return 1
  exe=$(observe_pid_executable "$pid" 2>/dev/null || true)

  {
    printf '%s\n' "$exe" > "$lockdir/executable" &&
      printf '%s\n' "$entrypoint" > "$lockdir/entrypoint" &&
      printf '%s\n' "${OBSERVE_DATA_ROOT:-}" > "$lockdir/data-root" &&
      printf '%s\n' "$instance" > "$lockdir/instance-id" &&
      printf '%s\n' "$(observe_now_epoch)" > "$lockdir/started-at" &&
      printf '%s\n' "$identity" > "$lockdir/pid-identity"
  } 2>/dev/null || return 1

  back=$(observe_read_line "$lockdir/pid" 2>/dev/null || true)
  [ "$back" = "$pid" ]
}

# One full claim attempt: create the directory, win the PID, record the details,
# then confirm the lock still names us. The final confirmation matters because a
# concurrent reclaim could have removed our lock between stages; failing here is
# correct and safe — the caller simply did not get the lock.
observe_lock_try_claim() { # <lock-dir> <instance-id> <entrypoint-marker> [pid]
  local lockdir=${1:-} instance=${2:-} entrypoint=${3:-} pid=${4:-} back
  [ -n "$lockdir" ] || return 1
  [ -n "$pid" ] || pid=${BASHPID:-$$}
  observe_is_pid "$pid" || return 1

  mkdir "$lockdir" 2>/dev/null || true
  [ -d "$lockdir" ] || return 1

  observe_lock_claim_pid "$lockdir" "$pid" || return 1
  if ! observe_lock_write_details "$lockdir" "$instance" "$entrypoint" "$pid"; then
    observe_lock_release_if_owner "$lockdir" "$pid"
    return 1
  fi

  back=$(observe_read_line "$lockdir/pid" 2>/dev/null || true)
  [ "$back" = "$pid" ]
}

# Remove a lock directory and only the files this kernel writes into it. rmdir
# fails if anything unexpected is inside, which is the behaviour we want: never
# recursively delete a directory whose contents we do not recognise.
observe_lock_remove() { # <lock-dir>
  local lockdir=${1:-} name
  [ -n "$lockdir" ] || return 1
  [ -d "$lockdir" ] || return 0
  for name in $OBSERVE_LOCK_FILES; do
    rm -f "$lockdir/$name" 2>/dev/null || true
  done
  rmdir "$lockdir" 2>/dev/null
}

# True while a lock is young enough that a claim could still be finishing its
# writes. An unreadable mtime counts as settling: refusing to reclaim leaves a
# stuck lock a human can clear, while reclaiming a lock mid-claim produces two
# collectors, which is the failure this whole kernel exists to prevent.
observe_lock_is_settling() { # <lock-dir>
  local lockdir=${1:-} created age
  created=$(observe_path_mtime "$lockdir" 2>/dev/null || true)
  observe_is_uint "$created" || return 0
  age=$(($(observe_now_epoch) - created))
  [ "$age" -lt "$OBSERVE_LOCK_SETTLE" ]
}

# True when a lock directory exists but its recorded owner is provably gone.
observe_lock_is_abandoned() { # <lock-dir>
  local lockdir=${1:-} pid identity
  [ -n "$lockdir" ] || return 1
  [ -d "$lockdir" ] || return 1

  pid=$(observe_read_line "$lockdir/pid" 2>/dev/null || true)
  identity=$(observe_read_line "$lockdir/pid-identity" 2>/dev/null || true)
  if ! observe_is_pid "$pid" || [ -z "$identity" ]; then
    # An incomplete record: either a claim still in progress (leave it alone) or
    # one that died mid-write (reclaimable once the settle window passes).
    observe_lock_is_settling "$lockdir" && return 1
    return 0
  fi

  observe_process_matches_lock "$lockdir" && return 1
  return 0
}

# Release a lock we own. A lock recording somebody else's PID is left alone:
# releasing another process's lock is how a supervisor deletes the singleton
# out from under a healthy collector.
observe_lock_release_if_owner() { # <lock-dir> [pid]
  local lockdir=${1:-} pid=${2:-} recorded
  [ -n "$lockdir" ] || return 1
  [ -d "$lockdir" ] || return 0
  [ -n "$pid" ] || pid=${BASHPID:-$$}
  recorded=$(observe_read_line "$lockdir/pid" 2>/dev/null || true)
  [ "$recorded" = "$pid" ] || return 1
  observe_lock_remove "$lockdir"
}

# ─── start lock ────────────────────────────────────────────────────────────

# Try once to claim the start lock. Returns 0 when this process now holds it,
# 1 when somebody else does.
#
# The one reclaim attempt covers a supervisor that was killed mid-start: its
# start lock would otherwise block every future start attempt forever. It only
# fires when the previous holder is provably gone.
observe_start_lock_try_acquire() { # [lock-dir]
  local lockdir=${1:-${OBSERVE_START_LOCK:-}}
  [ -n "$lockdir" ] || return 1

  observe_lock_try_claim "$lockdir" '' '' && return 0

  observe_lock_is_abandoned "$lockdir" || return 1
  observe_lock_remove "$lockdir" || return 1
  observe_lock_try_claim "$lockdir" '' ''
}

observe_start_lock_release() { # [lock-dir]
  observe_lock_release_if_owner "${1:-${OBSERVE_START_LOCK:-}}"
}

# ─── collector lock ────────────────────────────────────────────────────────

# Claim the collector lock for <instance-id>. Called by the collector itself
# (PR2) once it is up, never by a supervisor on the collector's behalf — the
# lock must record the identity of the process that actually serves.
observe_collector_lock_claim() { # <instance-id> [pid] [entrypoint-marker] [lock-dir]
  local instance=${1:-} pid=${2:-} entrypoint=${3:-${OBSERVE_ENTRYPOINT_MARKER:-}}
  local lockdir=${4:-${OBSERVE_LOCK:-}}
  [ -n "$instance" ] || return 1
  [ -n "$lockdir" ] || return 1
  observe_lock_try_claim "$lockdir" "$instance" "$entrypoint" "$pid"
}

# Read the lock into OBSERVE_LOCK_* globals and echo them as key=value lines.
# Returns 1 when there is no lock at all.
OBSERVE_LOCK_PID=
OBSERVE_LOCK_IDENTITY=
OBSERVE_LOCK_EXECUTABLE=
OBSERVE_LOCK_ENTRYPOINT=
OBSERVE_LOCK_DATA_ROOT=
OBSERVE_LOCK_INSTANCE_ID=
OBSERVE_LOCK_STARTED_AT=
observe_collector_lock_snapshot() { # [lock-dir]
  local lockdir=${1:-${OBSERVE_LOCK:-}}
  OBSERVE_LOCK_PID=
  OBSERVE_LOCK_IDENTITY=
  OBSERVE_LOCK_EXECUTABLE=
  OBSERVE_LOCK_ENTRYPOINT=
  OBSERVE_LOCK_DATA_ROOT=
  OBSERVE_LOCK_INSTANCE_ID=
  OBSERVE_LOCK_STARTED_AT=
  [ -n "$lockdir" ] || return 1
  [ -d "$lockdir" ] || return 1

  OBSERVE_LOCK_PID=$(observe_read_line "$lockdir/pid" 2>/dev/null || true)
  OBSERVE_LOCK_IDENTITY=$(observe_read_line "$lockdir/pid-identity" 2>/dev/null || true)
  OBSERVE_LOCK_EXECUTABLE=$(observe_read_line "$lockdir/executable" 2>/dev/null || true)
  OBSERVE_LOCK_ENTRYPOINT=$(observe_read_line "$lockdir/entrypoint" 2>/dev/null || true)
  OBSERVE_LOCK_DATA_ROOT=$(observe_read_line "$lockdir/data-root" 2>/dev/null || true)
  OBSERVE_LOCK_INSTANCE_ID=$(observe_read_line "$lockdir/instance-id" 2>/dev/null || true)
  OBSERVE_LOCK_STARTED_AT=$(observe_read_line "$lockdir/started-at" 2>/dev/null || true)

  printf 'pid=%s\n' "$OBSERVE_LOCK_PID"
  printf 'pid-identity=%s\n' "$OBSERVE_LOCK_IDENTITY"
  printf 'executable=%s\n' "$OBSERVE_LOCK_EXECUTABLE"
  printf 'entrypoint=%s\n' "$OBSERVE_LOCK_ENTRYPOINT"
  printf 'data-root=%s\n' "$OBSERVE_LOCK_DATA_ROOT"
  printf 'instance-id=%s\n' "$OBSERVE_LOCK_INSTANCE_ID"
  printf 'started-at=%s\n' "$OBSERVE_LOCK_STARTED_AT"
  return 0
}

observe_collector_lock_is_abandoned() { # [lock-dir]
  observe_lock_is_abandoned "${1:-${OBSERVE_LOCK:-}}"
}

# Remove an abandoned collector lock. Refuses (returns 1) when the lock still
# has a live, identity-matched owner — reclaiming a healthy collector's lock is
# the one thing this kernel must never do.
observe_collector_lock_reclaim() { # [lock-dir]
  local lockdir=${1:-${OBSERVE_LOCK:-}}
  [ -n "$lockdir" ] || return 1
  [ -d "$lockdir" ] || return 0
  observe_collector_lock_is_abandoned "$lockdir" || return 1
  # Re-check under the same call: the owner may have finished claiming between
  # the check above and this removal.
  observe_collector_lock_is_abandoned "$lockdir" || return 1
  observe_lock_remove "$lockdir"
}

# True when the lock belongs to <instance-id> AND to this data root. The data
# root check keeps a lock file copied or bind-mounted from another instance
# from being mistaken for ours.
observe_collector_lock_owned_by() { # <instance-id> [lock-dir]
  local instance=${1:-} lockdir=${2:-${OBSERVE_LOCK:-}} recorded root
  [ -n "$instance" ] || return 1
  [ -n "$lockdir" ] || return 1
  [ -d "$lockdir" ] || return 1
  recorded=$(observe_read_line "$lockdir/instance-id" 2>/dev/null || true)
  [ "$recorded" = "$instance" ] || return 1
  root=$(observe_read_line "$lockdir/data-root" 2>/dev/null || true)
  [ "$root" = "${OBSERVE_DATA_ROOT:-}" ] || return 1
  return 0
}

observe_collector_lock_release() { # [lock-dir] [pid]
  observe_lock_release_if_owner "${1:-${OBSERVE_LOCK:-}}" "${2:-}"
}
