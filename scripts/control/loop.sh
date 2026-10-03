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
AUTO_EVERY="${EUX_AUTO_EVERY:-30}"   # ticks of 2 s: look for new versions every minute

run_action() { # a copy of run.sh, because an update replaces run.sh itself
  local tmp; tmp="$(mktemp)"; cp "$RUN" "$tmp"
  EUX_ROOT="$ROOT" EUX_CONTROL_DIR="$CTL" bash "$tmp" "$@"
  local rc=$?; rm -f "$tmp"; return $rc
}

# The dashboard is a separate app and cannot read the other apps' .env files. This copies the OpenAI key you already
# gave Bot Buddy (or UEFN Trends) into the dashboard's .env, once, so you do not have to type it in twice.
# Returns 0 only when it copied something (the dashboard then needs to be created again to see it).
share_openai_key() {
  local dash="$ROOT/dashboard/.env" src key
  grep -q '^OPENAI_API_KEY=.\+' "$dash" 2>/dev/null && return 1
  for src in "$ROOT/bot-buddy/.env" "$ROOT/uefn-trends/.env"; do
    key="$(grep -E '^OPENAI_API_KEY=.+' "$src" 2>/dev/null | head -1 | cut -d= -f2-)"
    [ -n "$key" ] || continue
    touch "$dash"; chmod 600 "$dash"
    sed -i '/^OPENAI_API_KEY=/d' "$dash"
    printf 'OPENAI_API_KEY=%s\n' "$key" >> "$dash"
    return 0
  done
  return 1
}

# If the server rebooted or this service restarted in the middle of an action, close it properly.
if [ -f "$CTL/status.json" ] && grep -q '"state":"running"' "$CTL/status.json"; then
  if grep -q '"action":"reboot"' "$CTL/status.json"; then
    sed -e 's/"state":"running"/"state":"done"/' -e 's/"finishedAt":null/"finishedAt":'"$(now_ms)"'/' -e 's/"ok":null/"ok":true/' "$CTL/status.json" > "$CTL/status.json.tmp"
  else
    sed -e 's/"state":"running"/"state":"failed"/' -e 's/"finishedAt":null/"finishedAt":'"$(now_ms)"'/' -e 's/"ok":null/"ok":false/' "$CTL/status.json" > "$CTL/status.json.tmp"
  fi
  mv "$CTL/status.json.tmp" "$CTL/status.json"
fi

share_openai_key && run_action apply-config

tick=0
while true; do
  [ $((tick % 5)) -eq 0 ] && date +%s > "$CTL/alive"                       # "I'm here", every 10 s
  [ $((tick % 450)) -eq 0 ] && run_action versions                          # new versions on GitHub? every 15 min
  [ $((tick % 450)) -eq 225 ] && share_openai_key && run_action apply-config

  for f in $(ls -1 "$CTL/queue" 2>/dev/null | sort); do
    action="$(head -c 40 "$CTL/queue/$f" 2>/dev/null | tr -dc 'a-z-')"
    rm -f "$CTL/queue/$f"
    case "$action" in
      update|restart-all|restart-dashboard|restart-buddy|restart-trends|reboot)
        run_action "$action"
        date +%s > "$CTL/alive" ;;
    esac
  done

  # Automatic updates: when something new is pushed to GitHub, deploy it (switch: <control dir>/autoupdate).
  if [ -e "$CTL/autoupdate" ] && [ $((tick % AUTO_EVERY)) -eq $((AUTO_EVERY / 2)) ]; then
    if [ -n "$(run_action pending 2>/dev/null)" ]; then
      run_action auto-update
      date +%s > "$CTL/alive"
    fi
  fi

  # This file changed (an update): continue with the new version.
  [ "$(md5sum "$SELF" | cut -d' ' -f1)" = "$SUM" ] || exec bash "$SELF"
  tick=$((tick + 1))
  sleep 2
done
