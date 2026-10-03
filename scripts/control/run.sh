#!/usr/bin/env bash
# Runs ONE server action for the dashboard's Update / Restart buttons (or by hand: run.sh update).
#   update | restart-all | restart-dashboard | restart-buddy | restart-trends | reboot | versions
# Progress goes to <control dir>/status.json and log.txt, which the dashboard shows live.
set -uo pipefail

ROOT="${EUX_ROOT:-/opt/euphoriax}"
CTL="${EUX_CONTROL_DIR:-$ROOT/dashboard/data/control}"
ACTION="${1:-}"
LOG="$CTL/log.txt"
STATUS="$CTL/status.json"
mkdir -p "$CTL/queue"

now_ms() { echo $(( $(date +%s) * 1000 )); }
json_escape() { local s="${1//\\/\\\\}"; s="${s//\"/\\\"}"; printf '%s' "${s//[$'\t\r\n']/ }"; }

# app id -> folder, label
dir_of()   { case "$1" in dashboard) echo "$ROOT/dashboard";; buddy) echo "$ROOT/bot-buddy";; trends) echo "$ROOT/uefn-trends";; esac; }
label_of() { case "$1" in dashboard) echo "Dashboard";; buddy) echo "Discord bots";; trends) echo "UEFN Trends";; esac; }

STARTED="$(now_ms)"
write_status() { # state step ok finishedAt
  printf '{"state":"%s","action":"%s","step":"%s","startedAt":%s,"finishedAt":%s,"ok":%s}\n' \
    "$1" "$ACTION" "$(json_escape "$2")" "$STARTED" "${4:-null}" "${3:-null}" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

# What version is each app on, and is there something newer on GitHub?
write_versions() {
  local out="" first=1 id d hash date subject behind
  for id in dashboard buddy trends; do
    d="$(dir_of "$id")"
    [ -d "$d/.git" ] || continue
    git -C "$d" fetch -q origin >/dev/null 2>&1 || true
    hash="$(git -C "$d" log -1 --format=%h 2>/dev/null || echo '?')"
    date="$(git -C "$d" log -1 --format=%ct 2>/dev/null || echo 0)"
    subject="$(git -C "$d" log -1 --format=%s 2>/dev/null || echo '')"
    behind="$(git -C "$d" rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)"
    [ "$first" = 1 ] || out="$out,"; first=0
    out="$out{\"id\":\"$id\",\"label\":\"$(label_of "$id")\",\"hash\":\"$hash\",\"date\":$((date * 1000)),\"subject\":\"$(json_escape "${subject:0:90}")\",\"behind\":${behind:-0}}"
  done
  printf '{"checkedAt":%s,"apps":[%s]}\n' "$(now_ms)" "$out" > "$CTL/versions.json.tmp" && mv "$CTL/versions.json.tmp" "$CTL/versions.json"
}

if [ "$ACTION" = versions ]; then write_versions; exit 0; fi

case "$ACTION" in update|restart-all|restart-dashboard|restart-buddy|restart-trends|reboot) ;; *) echo "unknown action: $ACTION" >&2; exit 2;; esac

: > "$LOG"
exec > >(tee -a "$LOG") 2>&1
FAILED=0
step() { echo; echo "==> $*"; write_status running "$*"; }
run()  { "$@" || { echo "FAILED: $*"; FAILED=1; return 1; }; }
# run a command inside an app folder (no subshell, so a failure is remembered)
in_dir() { pushd "$1" >/dev/null || { FAILED=1; return 1; }; shift; run "$@"; local rc=$?; popd >/dev/null; return $rc; }

update_app() {
  local id="$1" d; d="$(dir_of "$id")"
  [ -d "$d" ] || { echo "$d not found, skipping"; return; }
  step "$(label_of "$id"): downloading the latest version"
  run git -C "$d" pull --ff-only || return
  step "$(label_of "$id"): building and restarting"
  in_dir "$d" docker compose up -d --build
}
restart_app() {
  local id="$1" d; d="$(dir_of "$id")"
  [ -d "$d" ] || { echo "$d not found, skipping"; return; }
  step "$(label_of "$id"): restarting"
  in_dir "$d" docker compose restart
}

echo "Started: $ACTION ($(date -u '+%Y-%m-%d %H:%M:%S') UTC)"
write_status running "starting"

case "$ACTION" in
  update)
    # The dashboard goes last so you can follow the progress until the end.
    for id in trends buddy dashboard; do update_app "$id"; done
    docker image prune -f >/dev/null 2>&1 || true ;;
  restart-all)       for id in trends buddy dashboard; do restart_app "$id"; done ;;
  restart-dashboard) restart_app dashboard ;;
  restart-buddy)     restart_app buddy ;;
  restart-trends)    restart_app trends ;;
  reboot)
    step "Rebooting the server (back in 1-2 minutes)"
    sync
    # The control service marks this run as finished when it starts again after the reboot.
    systemctl reboot || FAILED=1 ;;
esac

step "Checking versions"
write_versions
echo
if [ "$FAILED" = 0 ]; then echo "Done."; write_status done "" true "$(now_ms)"
else echo "Finished with errors, see above."; write_status failed "" false "$(now_ms)"; fi
exit "$FAILED"
