#!/usr/bin/env bash
# Read-only collector health diagnostic.
#
# Prints exactly one line and exits. It never signals a process, never removes
# or repairs a lock, and never creates a directory — a diagnostic that mutates
# state changes the answer it was asked to report, and would make a supervision
# bug impossible to observe.
#
# Output shapes:
#   collector: healthy pid=<pid> heartbeat=<age>s http=<ok|skipped>
#   collector: absent
#   collector: unhealthy reason=<reason> pid=<pid>
#   collector: invalid-owner reason=<reason> pid=<pid>
#
# Exit codes:
#   0  healthy
#   1  absent or unhealthy (a supervisor may start or restart the collector)
#   2  invalid configuration, or an unsafe ownership state a supervisor must
#      NOT act on blindly
set -u

SUPERVISION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/scripts/supervision/lib/observe-heartbeat.sh
. "$SUPERVISION_DIR/lib/observe-heartbeat.sh"

usage() {
  cat << 'EOF'
Usage: observe-health.sh [--data-root <path>]

Reports the health of the collector supervised under a data root. Read-only.

  --data-root <path>  Override AGENTS_OBSERVE_DATA_ROOT for this check.
  -h, --help          Show this help.
EOF
}

data_root=

while [ $# -gt 0 ]; do
  case "$1" in
    --data-root)
      [ $# -ge 2 ] || {
        printf 'observe-health: --data-root requires a value\n' >&2
        exit 2
      }
      data_root=$2
      shift 2
      ;;
    --data-root=*)
      data_root=${1#--data-root=}
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'observe-health: unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

observe_env_init "$data_root" || exit 2

observe_collector_healthy
rc=$?

case "$OBSERVE_HEALTH_STATUS" in
  healthy)
    printf 'collector: healthy pid=%s heartbeat=%ss http=%s\n' \
      "$OBSERVE_HEALTH_PID" "$OBSERVE_HEALTH_AGE" "$OBSERVE_HEALTH_HTTP"
    ;;
  absent)
    printf 'collector: absent\n'
    ;;
  *)
    if [ -n "$OBSERVE_HEALTH_PID" ]; then
      printf 'collector: %s reason=%s pid=%s\n' \
        "$OBSERVE_HEALTH_STATUS" "$OBSERVE_HEALTH_REASON" "$OBSERVE_HEALTH_PID"
    else
      printf 'collector: %s reason=%s\n' "$OBSERVE_HEALTH_STATUS" "$OBSERVE_HEALTH_REASON"
    fi
    ;;
esac

exit "$rc"
