#!/usr/bin/env bash
# Runs ONE server action for the dashboard's Update / Restart buttons and for automatic updates.
#   update | auto-update | restart-all | restart-dashboard | restart-buddy | restart-trends | reboot
#   versions   refresh versions.json (what runs, what is new on GitHub)
#   pending    refresh versions.json and print the apps that have something new worth deploying
# Progress goes to <control dir>/status.json and log.txt, which the dashboard shows live.
set -uo pipefail

ROOT="${EUX_ROOT:-/opt/euphoriax}"
CTL="${EUX_CONTROL_DIR:-$ROOT/dashboard/data/control}"
ACTION="${1:-}"
LOG="$CTL/log.txt"
STATUS="$CTL/status.json"
mkdir -p "$CTL/queue"

# After an update every app must answer on its health address, otherwise we go back to the previous version.
HEALTH_DASHBOARD="${EUX_HEALTH_DASHBOARD:-http://127.0.0.1:3200/dashboard/health}"
HEALTH_BUDDY="${EUX_HEALTH_BUDDY:-http://127.0.0.1:3000/health}"
HEALTH_TRENDS="${EUX_HEALTH_TRENDS:-http://127.0.0.1:3100/health}"
HEALTH_TRIES="${EUX_HEALTH_TRIES:-30}"     # x 3 s = about 90 s
HEALTH_SLEEP="${EUX_HEALTH_SLEEP:-3}"

now_ms() { echo $(( $(date +%s) * 1000 )); }
json_escape() { local s="${1//\\/\\\\}"; s="${s//\"/\\\"}"; printf '%s' "${s//[$'\t\r\n']/ }"; }

dir_of()    { case "$1" in dashboard) echo "$ROOT/dashboard";; buddy) echo "$ROOT/bot-buddy";; trends) echo "$ROOT/uefn-trends";; esac; }
label_of()  { case "$1" in dashboard) echo "Dashboard";; buddy) echo "Discord bots";; trends) echo "UEFN Trends";; esac; }
health_of() { case "$1" in dashboard) echo "$HEALTH_DASHBOARD";; buddy) echo "$HEALTH_BUDDY";; trends) echo "$HEALTH_TRENDS";; esac; }
healthy()      { curl -fsS -m 4 "$(health_of "$1")" >/dev/null 2>&1; }
wait_healthy() { local i; for i in $(seq 1 "$HEALTH_TRIES"); do healthy "$1" && return 0; sleep "$HEALTH_SLEEP"; done; return 1; }

STARTED="$(now_ms)"
NOTE=""
write_status() { # state step ok finishedAt
  printf '{"state":"%s","action":"%s","step":"%s","note":"%s","startedAt":%s,"finishedAt":%s,"ok":%s}\n' \
    "$1" "$ACTION" "$(json_escape "$2")" "$(json_escape "$NOTE")" "$STARTED" "${4:-null}" "${3:-null}" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

# What version is each app on, and is there something newer on GitHub?
write_versions() {
  local out="" first=1 id d hash date subject behind err remote blocked
  for id in dashboard buddy trends; do
    d="$(dir_of "$id")"
    [ -d "$d/.git" ] || continue
    err=false; git -C "$d" fetch -q origin >/dev/null 2>&1 || err=true
    hash="$(git -C "$d" log -1 --format=%h 2>/dev/null || echo '?')"
    date="$(git -C "$d" log -1 --format=%ct 2>/dev/null || echo 0)"
    subject="$(git -C "$d" log -1 --format=%s 2>/dev/null || echo '')"
    behind="$(git -C "$d" rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)"
    remote="$(git -C "$d" rev-parse '@{u}' 2>/dev/null || echo none)"
    blocked=false; [ "$(cat "$CTL/failed_$id" 2>/dev/null)" = "$remote" ] && blocked=true   # this exact version already failed here
    [ "$first" = 1 ] || out="$out,"; first=0
    out="$out{\"id\":\"$id\",\"label\":\"$(label_of "$id")\",\"hash\":\"$hash\",\"date\":$((date * 1000)),\"subject\":\"$(json_escape "${subject:0:90}")\",\"behind\":${behind:-0},\"error\":$err,\"blocked\":$blocked}"
  done
  printf '{"checkedAt":%s,"apps":[%s]}\n' "$(now_ms)" "$out" > "$CTL/versions.json.tmp" && mv "$CTL/versions.json.tmp" "$CTL/versions.json"
}

# Apps with something new that did not already fail (and get rolled back) on exactly that version.
pending_ids() {
  local id d behind remote
  for id in trends buddy dashboard; do
    d="$(dir_of "$id")"
    [ -d "$d/.git" ] || continue
    behind="$(git -C "$d" rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)"
    [ "${behind:-0}" -gt 0 ] || continue
    remote="$(git -C "$d" rev-parse '@{u}' 2>/dev/null || echo none)"
    [ "$(cat "$CTL/failed_$id" 2>/dev/null)" = "$remote" ] && continue
    echo "$id"
  done
}

if [ "$ACTION" = versions ]; then write_versions; exit 0; fi
if [ "$ACTION" = pending ]; then write_versions; pending_ids; exit 0; fi

case "$ACTION" in update|auto-update|restart-all|restart-dashboard|restart-buddy|restart-trends|reboot) ;; *) echo "unknown action: $ACTION" >&2; exit 2;; esac

: > "$LOG"
exec > >(tee -a "$LOG") 2>&1
FAILED=0
UPDATED=()
PROBLEMS=()
step() { echo; echo "==> $*"; write_status running "$*"; }
run()  { "$@" || { echo "FAILED: $*"; FAILED=1; return 1; }; }
# run a command inside an app folder (no subshell, so a failure is remembered)
in_dir() { pushd "$1" >/dev/null || { FAILED=1; return 1; }; shift; run "$@"; local rc=$?; popd >/dev/null; return $rc; }
join_by() { local sep="$1" out="" x; shift; for x in "$@"; do out="${out:+$out$sep}$x"; done; printf '%s' "$out"; }

update_app() {
  local id="$1" d prev new was_ok=0 label
  d="$(dir_of "$id")"; label="$(label_of "$id")"
  [ -d "$d" ] || { echo "$d not found, skipping"; return; }
  healthy "$id" && was_ok=1
  prev="$(git -C "$d" rev-parse HEAD 2>/dev/null)"

  step "$label: downloading the latest version"
  run git -C "$d" pull --ff-only || { PROBLEMS+=("$label: could not download"); return; }
  new="$(git -C "$d" rev-parse HEAD 2>/dev/null)"

  step "$label: building and restarting"
  if ! in_dir "$d" docker compose up -d --build; then
    # The build failed, so the old version keeps running. Keep the code in step with it.
    echo "Build failed: going back to the previous version of the code."
    git -C "$d" reset -q --hard "$prev"
    echo "$new" > "$CTL/failed_$id"
    PROBLEMS+=("$label: build failed, kept the previous version")
    return
  fi

  step "$label: waiting until it answers"
  if wait_healthy "$id"; then
    rm -f "$CTL/failed_$id"
    [ "$new" = "$prev" ] || UPDATED+=("$label")
    return
  fi

  FAILED=1
  if [ "$was_ok" = 1 ] && [ "$new" != "$prev" ]; then
    step "$label does not start with the new version: going back to the previous one"
    git -C "$d" reset -q --hard "$prev"
    in_dir "$d" docker compose up -d --build
    wait_healthy "$id" && echo "$label is running again on the previous version." || echo "$label still does not answer, check its logs."
    echo "$new" > "$CTL/failed_$id"
    PROBLEMS+=("$label: new version did not start, rolled back")
  else
    PROBLEMS+=("$label: does not answer (check its logs)")
  fi
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
  auto-update)
    for id in $(pending_ids); do update_app "$id"; done
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
[ "${#UPDATED[@]}" -gt 0 ] && NOTE="Updated: $(join_by ", " "${UPDATED[@]}")"
if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  [ "$FAILED" = 0 ] && FAILED=1
  NOTE="${NOTE:+$NOTE. }Problems: $(join_by "; " "${PROBLEMS[@]}")"
fi
echo
if [ "$FAILED" = 0 ]; then echo "Done.${NOTE:+ $NOTE}"; write_status done "" true "$(now_ms)"
else echo "Finished with errors, see above."; write_status failed "" false "$(now_ms)"; fi
exit "$FAILED"
