#!/usr/bin/env bash
# Long-running helper on the server (systemd: euphoriax-control). The dashboard only drops a request
# file in <control dir>/queue; this picks it up and runs ONE action from a fixed list. The dashboard
# container never gets access to docker or the host, so a hacked dashboard cannot run commands here.
set -u

ROOT="${EUX_ROOT:-/opt/euphoriax}"
CTL="${EUX_CONTROL_DIR:-$ROOT/dashboard/data/control}"
RUN="$ROOT/dashboard/scripts/control/run.sh"
SELF="${BASH_SOURCE[0]}"
SUM="$(md5sum "$SELF" | cut -d' ' -f1)"
mkdir -p "$CTL/queue"

now_ms() { echo $(( $(date +%s) * 1000 )); }

# If the server rebooted or this service restarted in the middle of an action, close it properly.
if [ -f "$CTL/status.json" ] && grep -q '"state":"running"' "$CTL/status.json"; then
  if grep -q '"action":"reboot"' "$CTL/status.json"; then
    sed -e 's/"state":"running"/"state":"done"/' -e 's/"finishedAt":null/"finishedAt":'"$(now_ms)"'/' -e 's/"ok":null/"ok":true/' "$CTL/status.json" > "$CTL/status.json.tmp"
  else
    sed -e 's/"state":"running"/"state":"failed"/' -e 's/"finishedAt":null/"finishedAt":'"$(now_ms)"'/' -e 's/"ok":null/"ok":false/' "$CTL/status.json" > "$CTL/status.json.tmp"
  fi
  mv "$CTL/status.json.tmp" "$CTL/status.json"
fi

tick=0
while true; do
  [ $((tick % 5)) -eq 0 ] && date +%s > "$CTL/alive"                       # "I'm here", every 10 s
  [ $((tick % 450)) -eq 0 ] && EUX_ROOT="$ROOT" EUX_CONTROL_DIR="$CTL" bash "$RUN" versions   # new versions on GitHub? every 15 min

  for f in $(ls -1 "$CTL/queue" 2>/dev/null | sort); do
    action="$(head -c 40 "$CTL/queue/$f" 2>/dev/null | tr -dc 'a-z-')"
    rm -f "$CTL/queue/$f"
    case "$action" in
      update|restart-all|restart-dashboard|restart-buddy|restart-trends|reboot)
        tmp="$(mktemp)"; cp "$RUN" "$tmp"   # a copy, because the update replaces run.sh itself
        EUX_ROOT="$ROOT" EUX_CONTROL_DIR="$CTL" bash "$tmp" "$action"
        rm -f "$tmp"
        date +%s > "$CTL/alive" ;;
    esac
  done

  # This file changed (an update): continue with the new version.
  [ "$(md5sum "$SELF" | cut -d' ' -f1)" = "$SUM" ] || exec bash "$SELF"
  tick=$((tick + 1))
  sleep 2
done
