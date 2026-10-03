#!/usr/bin/env bash
# One-time install of the helper behind the dashboard's Update / Restart buttons. Run as root on the server:
#   bash /opt/euphoriax/dashboard/scripts/install-control.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
ROOT="${EUX_ROOT:-/opt/euphoriax}"
CTL="$ROOT/dashboard/data/control"
mkdir -p "$CTL/queue"
chmod +x "$ROOT/dashboard/scripts/control/"*.sh
# Automatic updates are on by default (switch in the dashboard: Status -> Server). Only decided once.
if [ ! -e "$CTL/autoupdate.configured" ]; then touch "$CTL/autoupdate" "$CTL/autoupdate.configured"; fi

cat > /etc/systemd/system/euphoriax-control.service <<UNIT
[Unit]
Description=Euphoriax server control (dashboard Update / Restart buttons)
After=docker.service network-online.target
Wants=network-online.target

[Service]
Environment=EUX_ROOT=$ROOT
Environment=HOME=/root
ExecStart=/bin/bash $ROOT/dashboard/scripts/control/loop.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# Updating by hand still works, and now uses exactly the same steps as the button.
cat > "$ROOT/update.sh" <<'UPDATE'
#!/usr/bin/env bash
exec bash /opt/euphoriax/dashboard/scripts/control/run.sh update
UPDATE
chmod +x "$ROOT/update.sh"

systemctl daemon-reload
systemctl enable --now euphoriax-control
systemctl restart euphoriax-control
echo
echo "Done. Open the dashboard → Status: the Server box now has Update and Restart buttons."
