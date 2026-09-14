#!/usr/bin/env bash
# Liveness and the canonical health predicate for the collector supervision
# kernel.
#
# The heartbeat answers a question the lock cannot: the collector process is
# alive, but is it still *working*? A wedged collector holds its lock and its
# PID perfectly while serving nothing. So the collector republishes the
# heartbeat on every cycle, and a heartbeat older than the grace window means
# unhealthy even though the process is up.
#
# The heartbeat carries the same instanceId as the lock. Without that binding,
# a heartbeat left behind by a previous collector — or published by a second
# collector that lost the lock race — would keep the current lock looking
# healthy. Fresh is not enough; it has to be fresh *and* ours.
#
# File format, one key=value per line:
#   instanceId=<id>
#   pid=<pid>
#   updatedAt=<epoch seconds>

[ -n "${OBSERVE_HEARTBEAT_SH_LOADED:-}" ] && return 0
OBSERVE_HEARTBEAT_SH_LOADED=1

# shellcheck source=hooks/scripts/supervision/lib/observe-lock.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/observe-lock.sh"

# Age reported for a heartbeat that does not exist or cannot be parsed. Larger
# than any sane grace window, so "missing" always compares as "not fresh".
OBSERVE_HEARTBEAT_AGE_UNKNOWN=999999

observe_heartbeat_field() { # <key> [heartbeat-path]
  local key=${1:-} path=${2:-${OBSERVE_HEARTBEAT:-}} line
  [ -n "$key" ] || return 1
  [ -n "$path" ] || return 1
  [ -f "$path" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$key="*)
        printf '%s\n' "${line#"$key"=}"
        return 0
        ;;
    esac
  done < "$path"
  return 1
}

# Publish a heartbeat. Written to a temp file and renamed so a reader never
# sees a half-written record.
observe_heartbeat_publish() { # <instance-id> [pid] [heartbeat-path]
  local instance=${1:-} pid=${2:-} path=${3:-${OBSERVE_HEARTBEAT:-}} tmp
  [ -n "$instance" ] || return 1
  [ -n "$path" ] || return 1
  [ -n "$pid" ] || pid=${BASHPID:-$$}
  tmp="$path.tmp.$$"
  {
    printf 'instanceId=%s\n' "$instance"
    printf 'pid=%s\n' "$pid"
    printf 'updatedAt=%s\n' "$(observe_now_epoch)"
  } > "$tmp" 2>/dev/null || return 1
  mv -f "$tmp" "$path" 2>/dev/null || {
    rm -f "$tmp" 2>/dev/null || true
    return 1
  }
  return 0
}

# Age of the heartbeat in seconds. Prefers the embedded updatedAt (survives
# copies and filesystems with coarse timestamps) and falls back to mtime.
# Always prints a number; returns 1 when that number is the unknown sentinel.
observe_heartbeat_age() { # [heartbeat-path]
  local path=${1:-${OBSERVE_HEARTBEAT:-}} stamp age
  if [ -z "$path" ] || [ ! -f "$path" ]; then
    printf '%s\n' "$OBSERVE_HEARTBEAT_AGE_UNKNOWN"
    return 1
  fi
  stamp=$(observe_heartbeat_field updatedAt "$path" 2>/dev/null || true)
  if ! observe_is_uint "$stamp"; then
    stamp=$(observe_path_mtime "$path" 2>/dev/null || true)
  fi
  if ! observe_is_uint "$stamp"; then
    printf '%s\n' "$OBSERVE_HEARTBEAT_AGE_UNKNOWN"
    return 1
  fi
  age=$(($(observe_now_epoch) - stamp))
  # A clock step backwards must not read as "fresh forever" in one direction
  # and a huge age in the other; clamp the impossible side to 0.
  [ "$age" -lt 0 ] && age=0
  printf '%s\n' "$age"
  return 0
}

observe_heartbeat_fresh() { # [grace] [heartbeat-path]
  local grace=${1:-${OBSERVE_HEALTH_GRACE:-30}} path=${2:-${OBSERVE_HEARTBEAT:-}} age
  age=$(observe_heartbeat_age "$path") || return 1
  [ "$age" -lt "$grace" ]
}

# True when the heartbeat and the lock name the same instance. Both sides must
# be non-empty: two blank instance ids are not a match.
observe_heartbeat_matches_lock() { # [lock-dir] [heartbeat-path]
  local lockdir=${1:-${OBSERVE_LOCK:-}} path=${2:-${OBSERVE_HEARTBEAT:-}} beat_instance lock_instance
  [ -n "$lockdir" ] || return 1
  [ -d "$lockdir" ] || return 1
  beat_instance=$(observe_heartbeat_field instanceId "$path" 2>/dev/null || true)
  [ -n "$beat_instance" ] || return 1
  lock_instance=$(observe_read_line "$lockdir/instance-id" 2>/dev/null || true)
  [ -n "$lock_instance" ] || return 1
  [ "$beat_instance" = "$lock_instance" ]
}

# HTTP leg of the health predicate.
#
# PR1 leaves OBSERVE_HEALTH_URL empty because the collector is not wired to the
# server yet, so this reports "skipped" and does not fail health. PR2 sets the
# URL and the leg starts counting — no signature change needed there.
# Sets OBSERVE_HEALTH_HTTP to ok | skipped | failed.
OBSERVE_HEALTH_HTTP=skipped
observe_http_health_check() { # [url]
  local url=${1:-${OBSERVE_HEALTH_URL:-}}
  if [ -z "$url" ]; then
    OBSERVE_HEALTH_HTTP=skipped
    return 0
  fi
  if ! command -v curl > /dev/null 2>&1; then
    OBSERVE_HEALTH_HTTP=skipped
    return 0
  fi
  if curl -fsS -m "${OBSERVE_HEALTH_HTTP_TIMEOUT:-2}" -o /dev/null "$url" 2>/dev/null; then
    OBSERVE_HEALTH_HTTP=ok
    return 0
  fi
  OBSERVE_HEALTH_HTTP=failed
  return 1
}

# Canonical health predicate. Read-only: it inspects, it never signals, removes
# a lock, or writes a file.
#
# Healthy means ALL of:
#   lock exists
#   AND the lock belongs to this data root
#   AND its PID is alive
#   AND the live process identity matches the recorded identity
#   AND the live process carries the recorded entrypoint marker
#   AND the heartbeat's instanceId matches the lock's
#   AND the heartbeat is within the grace window
#   AND the HTTP health check succeeds (when one is configured)
#
# Returns 0 healthy, 1 absent/unhealthy, 2 invalid or unsafe ownership state.
# Sets OBSERVE_HEALTH_STATUS (healthy|absent|unhealthy|invalid-owner),
# OBSERVE_HEALTH_REASON, OBSERVE_HEALTH_PID, OBSERVE_HEALTH_AGE,
# OBSERVE_HEALTH_HTTP.
OBSERVE_HEALTH_STATUS='absent'
OBSERVE_HEALTH_REASON=
OBSERVE_HEALTH_PID=
OBSERVE_HEALTH_AGE=
observe_collector_healthy() { # [grace]
  local grace=${1:-${OBSERVE_HEALTH_GRACE:-30}} live_identity
  OBSERVE_HEALTH_STATUS='absent'
  OBSERVE_HEALTH_REASON=
  OBSERVE_HEALTH_PID=
  OBSERVE_HEALTH_AGE=
  OBSERVE_HEALTH_HTTP=skipped

  if [ -z "${OBSERVE_LOCK:-}" ] || [ ! -d "$OBSERVE_LOCK" ]; then
    return 1
  fi

  observe_collector_lock_snapshot > /dev/null || return 1
  OBSERVE_HEALTH_PID=$OBSERVE_LOCK_PID

  # A lock recorded against a different data root is an ownership hazard, not a
  # restartable fault: something is supervising across namespaces.
  if [ -n "$OBSERVE_LOCK_DATA_ROOT" ] && [ "$OBSERVE_LOCK_DATA_ROOT" != "${OBSERVE_DATA_ROOT:-}" ]; then
    OBSERVE_HEALTH_STATUS='invalid-owner'
    OBSERVE_HEALTH_REASON='data-root-mismatch'
    return 2
  fi

  if ! observe_is_pid "$OBSERVE_LOCK_PID" || [ -z "$OBSERVE_LOCK_IDENTITY" ]; then
    OBSERVE_HEALTH_STATUS='invalid-owner'
    OBSERVE_HEALTH_REASON='malformed-lock'
    return 2
  fi

  # Dead PID is a plain fault: the collector went away and PR3's arm restarts
  # it. Nothing else has claimed the identity, so it is not a hazard.
  if ! observe_pid_alive "$OBSERVE_LOCK_PID"; then
    OBSERVE_HEALTH_STATUS='unhealthy'
    OBSERVE_HEALTH_REASON='dead-pid'
    return 1
  fi

  # From here the PID is alive but may not be ours. Anything below is an
  # ownership hazard: a supervisor must not signal or reclaim on this state
  # without a human or a stricter check.
  live_identity=$(observe_pid_identity "$OBSERVE_LOCK_PID" 2>/dev/null || true)
  if [ -z "$live_identity" ] || [ "$live_identity" != "$OBSERVE_LOCK_IDENTITY" ]; then
    OBSERVE_HEALTH_STATUS='invalid-owner'
    OBSERVE_HEALTH_REASON='pid-identity-mismatch'
    return 2
  fi
  if [ -n "$OBSERVE_LOCK_ENTRYPOINT" ] &&
    ! observe_pid_has_marker "$OBSERVE_LOCK_PID" "$OBSERVE_LOCK_ENTRYPOINT"; then
    OBSERVE_HEALTH_STATUS='invalid-owner'
    OBSERVE_HEALTH_REASON='entrypoint-mismatch'
    return 2
  fi

  OBSERVE_HEALTH_AGE=$(observe_heartbeat_age) || {
    OBSERVE_HEALTH_STATUS='unhealthy'
    OBSERVE_HEALTH_REASON='missing-heartbeat'
    return 1
  }

  # A fresh heartbeat from a different instance is worse than no heartbeat: two
  # collectors are alive in one data root.
  if ! observe_heartbeat_matches_lock; then
    OBSERVE_HEALTH_STATUS='invalid-owner'
    OBSERVE_HEALTH_REASON='instance-mismatch'
    return 2
  fi

  if [ "$OBSERVE_HEALTH_AGE" -ge "$grace" ]; then
    OBSERVE_HEALTH_STATUS='unhealthy'
    OBSERVE_HEALTH_REASON='stale-heartbeat'
    return 1
  fi

  if ! observe_http_health_check; then
    OBSERVE_HEALTH_STATUS='unhealthy'
    OBSERVE_HEALTH_REASON='http-unhealthy'
    return 1
  fi

  OBSERVE_HEALTH_STATUS='healthy'
  return 0
}
