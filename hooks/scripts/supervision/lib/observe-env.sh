#!/usr/bin/env bash
# Path and config resolution for the collector supervision kernel.
#
# Every other supervision script gets its paths from here — nothing else
# resolves a data root or builds a runtime path by hand. This mirrors the
# repo rule that all env vars live in one place (hooks/scripts/lib/config.mjs
# for the Node side; this file for the shell side).
#
# One data root == one supervised collector instance. Two different data roots
# are fully independent: separate lock, separate heartbeat, separate log.
#
# Resolution is READ-ONLY. Nothing here creates a directory unless the caller
# explicitly asks via observe_runtime_ensure, so read-only callers (the health
# CLI) can resolve paths without touching the filesystem.

[ -n "${OBSERVE_ENV_SH_LOADED:-}" ] && return 0
OBSERVE_ENV_SH_LOADED=1

OBSERVE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# lib -> supervision -> scripts -> hooks -> repo root
OBSERVE_ROOT="${OBSERVE_ROOT:-$(cd "$OBSERVE_LIB_DIR/../../../.." && pwd)}"

# Grace window for heartbeat freshness, in seconds. A collector that has not
# published a heartbeat within this window is unhealthy.
OBSERVE_HEALTH_GRACE=${AGENTS_OBSERVE_HEALTH_GRACE:-30}
# How long a start attempt waits for a freshly forked collector to claim the
# lock and publish its first heartbeat, in seconds. Consumed by PR3's arm.
OBSERVE_START_TIMEOUT=${AGENTS_OBSERVE_START_TIMEOUT:-15}
# Poll interval while waiting for that confirmation, in seconds.
OBSERVE_START_POLL=${AGENTS_OBSERVE_START_POLL:-0.2}

# Stable identity marker expected in the collector's command line. It must NOT
# be the full command line: argv changes across restarts (ports, flags, node
# paths) and would turn every restart into an identity mismatch.
OBSERVE_ENTRYPOINT_MARKER=${AGENTS_OBSERVE_ENTRYPOINT_MARKER:-agents-observe-collector}

# Optional HTTP health endpoint. Empty in PR1 — the collector is not wired to
# the server yet, so the HTTP leg of the health predicate reports "skipped".
# PR2 sets this and the leg starts counting without any API change here.
OBSERVE_HEALTH_URL=${AGENTS_OBSERVE_HEALTH_URL:-}
# Seconds to wait on that HTTP check before calling it failed.
OBSERVE_HEALTH_HTTP_TIMEOUT=${AGENTS_OBSERVE_HEALTH_HTTP_TIMEOUT:-2}

# Root under which per-process identity is read. Overridable so tests can prove
# the /proc-less fallback path without needing a machine that lacks /proc.
OBSERVE_PROC_ROOT=${AGENTS_OBSERVE_PROC_ROOT:-/proc}

# Declared empty at source time so callers running under `set -u` can reference
# them before observe_env_init without tripping the unbound-variable trap.
OBSERVE_ENV_ERROR=
OBSERVE_DATA_ROOT=
OBSERVE_RUNTIME=
OBSERVE_LOCK=
OBSERVE_START_LOCK=
OBSERVE_HEARTBEAT=
OBSERVE_LIFECYCLE_LOG=

# Reject data roots that would make the runtime layout unsafe or ambiguous.
# Absolute, not the filesystem root, no relative segments, no newlines/tabs
# (they would corrupt the line-oriented lock and heartbeat files).
observe_data_root_is_safe() { # <path>
  local path=${1:-}
  [ -n "$path" ] || return 1
  case "$path" in
    /) return 1 ;;
    /*) ;;
    *) return 1 ;;
  esac
  case "$path" in
    *[$'\n\t']*) return 1 ;;
  esac
  case "$path" in
    */../* | */.. | ../* | */./* | */.) return 1 ;;
  esac
  return 0
}

# Resolve the data root and every runtime path derived from it.
#
# Precedence:
#   1. explicit argument (used by tests and by callers supervising a
#      non-default instance)
#   2. AGENTS_OBSERVE_DATA_ROOT — the supervision namespace
#   3. AGENTS_OBSERVE_LOCAL_DATA_ROOT — the existing data-dir override read by
#      hooks/scripts/lib/config.mjs, so supervision lands beside the DB by
#      default instead of in a second location
#   4. $HOME/.agents-observe — the same per-user fallback config.mjs uses
#
# Returns 2 with a message on stderr when no safe root can be resolved. Callers
# map that to their "invalid configuration" exit code.
observe_env_init() { # [data-root]
  local root=${1:-}
  OBSERVE_ENV_ERROR=

  if [ -z "$root" ]; then
    root=${AGENTS_OBSERVE_DATA_ROOT:-}
  fi
  if [ -z "$root" ]; then
    root=${AGENTS_OBSERVE_LOCAL_DATA_ROOT:-}
  fi
  if [ -z "$root" ] && [ -n "${HOME:-}" ]; then
    root="$HOME/.agents-observe"
  fi

  if [ -z "$root" ]; then
    OBSERVE_ENV_ERROR='no data root: set AGENTS_OBSERVE_DATA_ROOT (HOME is unset)'
    printf 'observe-env: %s\n' "$OBSERVE_ENV_ERROR" >&2
    return 2
  fi
  # Strip a single trailing slash so paths never come out doubled.
  case "$root" in
    */) root=${root%/} ;;
  esac
  if ! observe_data_root_is_safe "$root"; then
    OBSERVE_ENV_ERROR="unsafe data root: '$root'"
    printf 'observe-env: %s\n' "$OBSERVE_ENV_ERROR" >&2
    return 2
  fi

  OBSERVE_DATA_ROOT=$root
  OBSERVE_RUNTIME="$OBSERVE_DATA_ROOT/runtime"
  OBSERVE_LOCK="$OBSERVE_RUNTIME/collector.lock"
  OBSERVE_START_LOCK="$OBSERVE_RUNTIME/collector-start.lock"
  OBSERVE_HEARTBEAT="$OBSERVE_RUNTIME/collector.heartbeat"
  OBSERVE_LIFECYCLE_LOG="$OBSERVE_RUNTIME/collector-lifecycle.log"
  return 0
}

# Create the runtime directory. Split out from observe_env_init so resolving
# paths stays free of side effects.
observe_runtime_ensure() {
  [ -n "${OBSERVE_RUNTIME:-}" ] || {
    printf 'observe-env: observe_runtime_ensure called before observe_env_init\n' >&2
    return 2
  }
  mkdir -p "$OBSERVE_RUNTIME" 2>/dev/null || {
    printf 'observe-env: cannot create runtime dir: %s\n' "$OBSERVE_RUNTIME" >&2
    return 2
  }
  return 0
}

# Read the first line of a file, or print nothing when it is missing or
# unreadable. The lock and heartbeat files are one value per line, so this is
# the only reader any supervision script needs.
observe_read_line() { # <path>
  local path=${1:-} line
  [ -n "$path" ] || return 1
  [ -f "$path" ] || return 1
  IFS= read -r line < "$path" 2>/dev/null || true
  printf '%s\n' "${line:-}"
}

# Current epoch seconds. One definition so age math agrees everywhere.
observe_now_epoch() {
  date +%s
}

# mtime of a path in epoch seconds, or empty when it cannot be read.
# BSD stat (macOS) and GNU stat (Linux/WSL) disagree on the flag.
observe_path_mtime() { # <path>
  local path=${1:-}
  [ -n "$path" ] || return 1
  if [ "$(uname)" = Darwin ]; then
    stat -f %m "$path" 2>/dev/null
  else
    stat -c %Y "$path" 2>/dev/null
  fi
}
