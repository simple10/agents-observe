#!/usr/bin/env bash
# Process identity for the collector supervision kernel.
#
# A PID alone is never proof of ownership. The kernel recycles PIDs, so a lock
# recorded against PID 4242 can, minutes later, be pointing at somebody's `vim`.
# Acting on that PID (signalling it, or trusting it as a live collector) is the
# failure this file exists to prevent.
#
# Identity therefore combines:
#   - the PID
#   - the process start time (immune to PID reuse: a reused PID always has a
#     later start time)
#   - the executable behind the process
# and is checked alongside a stable entrypoint marker recorded in the lock.
#
# The marker is deliberately NOT the full command line. argv changes across
# restarts (port, flags, node path, absolute vs relative script path), so
# matching it would make every ordinary restart look like an impostor.

[ -n "${OBSERVE_PROCESS_SH_LOADED:-}" ] && return 0
OBSERVE_PROCESS_SH_LOADED=1

# shellcheck source=hooks/scripts/supervision/lib/observe-env.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/observe-env.sh"

# Non-empty and all digits. Used for PIDs and for the epoch/tick numbers that
# identity and heartbeat math depend on — a non-numeric value there means the
# source is unreadable, never "zero".
observe_is_uint() { # <value>
  case "${1:-}" in
    '' | *[!0-9]*) return 1 ;;
  esac
  return 0
}

observe_is_pid() { # <pid>
  observe_is_uint "${1:-}"
}

observe_pid_alive() { # <pid>
  observe_is_pid "${1:-}" || return 1
  kill -0 "$1" 2>/dev/null
}

# Path to the executable behind a PID, or empty when it cannot be determined.
# /proc/<pid>/exe is exact; ps gives a bounded, deterministic fallback where
# /proc does not exist (macOS) or is not readable.
observe_pid_executable() { # <pid>
  local pid=${1:-} exe
  observe_is_pid "$pid" || return 1
  if [ -r "$OBSERVE_PROC_ROOT/$pid/exe" ]; then
    exe=$(readlink "$OBSERVE_PROC_ROOT/$pid/exe" 2>/dev/null || true)
    if [ -n "$exe" ]; then
      printf '%s\n' "$exe"
      return 0
    fi
  fi
  exe=$(LC_ALL=C ps -p "$pid" -o comm= 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//') || return 1
  printf '%s\n' "$exe"
}

# The process's command line as a single space-separated line. Used only to
# look for the stable entrypoint marker, never compared whole.
observe_pid_cmdline() { # <pid>
  local pid=${1:-} out
  observe_is_pid "$pid" || return 1
  if [ -r "$OBSERVE_PROC_ROOT/$pid/cmdline" ]; then
    out=$(tr '\0' ' ' < "$OBSERVE_PROC_ROOT/$pid/cmdline" 2>/dev/null || true)
    if [ -n "$out" ]; then
      printf '%s\n' "$out"
      return 0
    fi
  fi
  out=$(LC_ALL=C ps -p "$pid" -o command= 2>/dev/null) || return 1
  [ -n "$out" ] || return 1
  printf '%s\n' "$out"
}

# Stable identity string for a PID, or non-zero when the process is gone.
#
# Linux/WSL: field 22 of /proc/<pid>/stat is the start time in clock ticks
# since boot. It is monotonic against the boot clock, so unlike a formatted
# wall-clock date it does not re-render when the host clock steps (a real WSL2
# problem) and falsely evict a live collector.
#
# Elsewhere (macOS, or any host without a readable /proc): `ps -o lstart` under
# LC_ALL=C. The locale pin matters — the identity is written under one locale
# and re-read under whatever the ambient locale is later.
observe_pid_identity() { # <pid>
  local pid=${1:-} stat_line starttime exe out
  local -a fields
  observe_is_pid "$pid" || return 1
  exe=$(observe_pid_executable "$pid" 2>/dev/null || true)

  if [ -r "$OBSERVE_PROC_ROOT/$pid/stat" ]; then
    stat_line=$(cat "$OBSERVE_PROC_ROOT/$pid/stat" 2>/dev/null) || return 1
    # comm (field 2) may contain spaces and parens; everything after the last
    # ')' is field 3 onward, so array index 19 is field 22 (starttime).
    read -r -a fields <<< "${stat_line##*)}"
    [ "${#fields[@]}" -ge 20 ] || return 1
    starttime=${fields[19]}
    observe_is_uint "$starttime" || return 1
    printf 'pid=%s starttime=%s exe=%s\n' "$pid" "$starttime" "$exe"
    return 0
  fi

  out=$(LC_ALL=C ps -p "$pid" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//') || return 1
  [ -n "$out" ] || return 1
  printf 'pid=%s started=%s exe=%s\n' "$pid" "$out" "$exe"
}

# True when the live process carries the expected entrypoint marker.
observe_pid_has_marker() { # <pid> <marker>
  local pid=${1:-} marker=${2:-} cmdline
  [ -n "$marker" ] || return 1
  cmdline=$(observe_pid_cmdline "$pid" 2>/dev/null) || return 1
  case "$cmdline" in
    *"$marker"*) return 0 ;;
  esac
  return 1
}

# True only when the process recorded in <lock-dir> is still that same process.
#
# Checks, in order: a usable recorded PID, that PID alive, the live identity
# equal to the recorded identity (this is what catches PID reuse), and the live
# process carrying the recorded entrypoint marker (this is what catches an
# unrelated process that merely happens to be alive).
observe_process_matches_lock() { # <lock-dir>
  local lockdir=${1:-${OBSERVE_LOCK:-}} pid recorded_identity recorded_entrypoint live_identity
  [ -n "$lockdir" ] || return 1
  [ -d "$lockdir" ] || return 1

  pid=$(observe_read_line "$lockdir/pid" 2>/dev/null || true)
  observe_is_pid "$pid" || return 1
  observe_pid_alive "$pid" || return 1

  recorded_identity=$(observe_read_line "$lockdir/pid-identity" 2>/dev/null || true)
  [ -n "$recorded_identity" ] || return 1
  live_identity=$(observe_pid_identity "$pid" 2>/dev/null || true)
  [ -n "$live_identity" ] || return 1
  [ "$live_identity" = "$recorded_identity" ] || return 1

  recorded_entrypoint=$(observe_read_line "$lockdir/entrypoint" 2>/dev/null || true)
  if [ -n "$recorded_entrypoint" ]; then
    observe_pid_has_marker "$pid" "$recorded_entrypoint" || return 1
  fi
  return 0
}

# Signal the collector recorded in the lock — and only it.
#
# The identity check runs first, every time, so this can never deliver a signal
# to a reused PID or to an unrelated process. There is no pattern-matching kill
# path anywhere in this kernel: `pkill -f` would hit every data root's collector
# on the machine, not just this one's.
observe_signal_locked_process() { # <signal> [lock-dir]
  local signal=${1:-TERM} lockdir=${2:-${OBSERVE_LOCK:-}} pid
  [ -n "$lockdir" ] || return 1
  observe_process_matches_lock "$lockdir" || return 1
  pid=$(observe_read_line "$lockdir/pid" 2>/dev/null || true)
  observe_is_pid "$pid" || return 1
  kill -"$signal" "$pid" 2>/dev/null
}
