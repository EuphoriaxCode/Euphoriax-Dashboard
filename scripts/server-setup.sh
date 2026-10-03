#!/usr/bin/env bash
# Euphoriax server setup - run once on a fresh Hetzner Ubuntu 24.04 server as root:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/EuphoriaxCode/Euphoriax-Dashboard/HEAD/scripts/server-setup.sh)
#
# Installs Docker + Caddy (HTTPS), downloads Euphoriax-Dashboard, Discord-Bot-Buddy and UEFN-Trends,
# links them together with generated keys, and starts everything. Safe to run again: existing settings are kept.
set -euo pipefail

DOMAIN="${DOMAIN:-euphoriax.net}"
ROOT=/opt/euphoriax
ORG=EuphoriaxCode
BRANCH="${BRANCH:-}"   # dashboard branch to install (empty = the default branch)

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ask()  { local q="$1" var="$2" def="${3:-}"; local a; read -r -p "$q${def:+ [$def]}: " a </dev/tty; printf -v "$var" '%s' "${a:-$def}"; }
secret() { openssl rand -hex 24; }
# set_env FILE KEY VALUE : replace KEY=... or append it
set_env() {
  local f="$1" k="$2" v="$3"
  if grep -q "^$k=" "$f" 2>/dev/null; then
    v="${v//\\/\\\\}"; v="${v//&/\\&}"; v="${v//|/\\|}"
    sed -i "s|^$k=.*|$k=$v|" "$f"
  else
    echo "$k=$v" >> "$f"
  fi
}
get_env() { grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2-; }

[ "$(id -u)" = 0 ] || { echo "Run this as root (ssh root@your-server)."; exit 1; }

say "Euphoriax server setup for $DOMAIN"
echo "This takes about 10 minutes. You'll be asked a few questions; press Enter to skip anything you don't have yet."

# ---------------------------------------------------------------- system
say "Updating the system and installing basics"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq git curl ufw unattended-upgrades ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

# Swap so builds don't run out of memory on a 4 GB server.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Firewall: only SSH and web traffic"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi

if ! command -v caddy >/dev/null; then
  say "Installing Caddy (automatic HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

if ! command -v gh >/dev/null; then
  say "Installing the GitHub tool (Bot Buddy and UEFN Trends are private repos)"
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
  apt-get update -qq && apt-get install -y -qq gh >/dev/null
fi
if ! gh auth status >/dev/null 2>&1; then
  say "Log in to GitHub"
  echo "Choose: GitHub.com → HTTPS → Yes → Login with a web browser. Then open the link on your laptop and type the code."
  gh auth login --hostname github.com --git-protocol https --web </dev/tty
  gh auth setup-git
fi

# ---------------------------------------------------------------- code
say "Downloading the code"
mkdir -p "$ROOT"
clone() { [ -d "$ROOT/$2/.git" ] && git -C "$ROOT/$2" pull -q || gh repo clone "$ORG/$1" "$ROOT/$2" -- -q; }
[ -d "$ROOT/dashboard/.git" ] || gh repo clone "$ORG/Euphoriax-Dashboard" "$ROOT/dashboard" -- -q ${BRANCH:+-b "$BRANCH"}
git -C "$ROOT/dashboard" pull -q
clone Discord-Bot-Buddy bot-buddy
clone UEFN-Trends uefn-trends

# ---------------------------------------------------------------- questions
BUDDY_ENV="$ROOT/bot-buddy/.env"
TRENDS_ENV="$ROOT/uefn-trends/.env"
DASH_ENV="$ROOT/dashboard/.env"
FIRST_RUN=0
[ -f "$BUDDY_ENV" ] || { cp "$ROOT/bot-buddy/.env.example" "$BUDDY_ENV"; FIRST_RUN=1; }
[ -f "$TRENDS_ENV" ] || cp "$ROOT/uefn-trends/.env.example" "$TRENDS_ENV"
touch "$DASH_ENV"

if [ "$FIRST_RUN" = 1 ]; then
  say "A few questions (Enter = skip, you can fill it in later)"
  echo "OpenAI key: platform.openai.com → API keys. Used by the Discord bots and UEFN Trends (a few dollars a month at most)."
  ask "OpenAI API key" OPENAI_KEY
  echo
  echo "Discord: discord.com/developers/applications → your bot → Bot → Reset Token (token) / General Information (Application ID)."
  echo "Server ID and user ID: turn on Developer Mode in Discord, then right-click → Copy ID."
  ask "Discord server ID" GUILD_ID
  ask "Founder bot A token" BOT_A_TOKEN
  ask "Founder bot A Application ID" BOT_A_ID
  ask "Founder bot A display name" BOT_A_NAME "Founder A"
  ask "Founder bot B token (optional)" BOT_B_TOKEN
  ask "Founder bot B Application ID (optional)" BOT_B_ID
  ask "Founder bot B display name" BOT_B_NAME "Founder B"
  ask "Your Discord user ID (gets pinged when the bots don't know an answer)" OWNER_ID
  ask "Discord webhook URL for the daily trend report (optional)" TREND_WEBHOOK

  set_env "$BUDDY_ENV" NODE_ENV production
  set_env "$BUDDY_ENV" OPENAI_API_KEY "$OPENAI_KEY"
  set_env "$BUDDY_ENV" DISCORD_GUILD_ID "$GUILD_ID"
  set_env "$BUDDY_ENV" DISCORD_BOT_A_TOKEN "$BOT_A_TOKEN"
  set_env "$BUDDY_ENV" DISCORD_BOT_A_CLIENT_ID "$BOT_A_ID"
  set_env "$BUDDY_ENV" DISCORD_BOT_B_TOKEN "$BOT_B_TOKEN"
  set_env "$BUDDY_ENV" DISCORD_BOT_B_CLIENT_ID "$BOT_B_ID"
  set_env "$BUDDY_ENV" FOUNDER_A_DISPLAY_NAME "$BOT_A_NAME"
  set_env "$BUDDY_ENV" FOUNDER_B_DISPLAY_NAME "$BOT_B_NAME"
  set_env "$BUDDY_ENV" AJUINNN_USER_ID "$OWNER_ID"
  # Without a bot token the backend still starts, so the rest keeps working.
  if [ -z "$BOT_A_TOKEN" ] && [ -z "$BOT_B_TOKEN" ]; then set_env "$BUDDY_ENV" DISCORD_ENABLED false; fi

  set_env "$TRENDS_ENV" OPENAI_API_KEY "$OPENAI_KEY"
  set_env "$TRENDS_ENV" DISCORD_WEBHOOK_URL "$TREND_WEBHOOK"
  [ -z "$OPENAI_KEY" ] && set_env "$TRENDS_ENV" AI_ENABLED false
fi

# ---------------------------------------------------------------- link everything with generated keys
say "Linking the three apps together"
BUDDY_KEY="$(get_env "$BUDDY_ENV" DASHBOARD_API_KEY)"; [ -n "$BUDDY_KEY" ] || BUDDY_KEY="$(secret)"
HOOK_SECRET="$(get_env "$BUDDY_ENV" DASHBOARD_WEBHOOK_SECRET)"; [ -n "$HOOK_SECRET" ] || HOOK_SECRET="$(secret)"
TRENDS_KEY="$(get_env "$TRENDS_ENV" API_ADMIN_KEY)"; [ -n "$TRENDS_KEY" ] || TRENDS_KEY="$(secret)"
PG_PASS="$(get_env "$TRENDS_ENV" POSTGRES_PASSWORD)"; { [ -n "$PG_PASS" ] && [ "$PG_PASS" != change-me ]; } || PG_PASS="$(secret)"

set_env "$BUDDY_ENV" DASHBOARD_API_KEY "$BUDDY_KEY"
set_env "$BUDDY_ENV" DASHBOARD_WEBHOOK_URL "https://$DOMAIN/dashboard/api/webhooks/buddy"
set_env "$BUDDY_ENV" DASHBOARD_WEBHOOK_SECRET "$HOOK_SECRET"
set_env "$TRENDS_ENV" API_ADMIN_KEY "$TRENDS_KEY"
set_env "$TRENDS_ENV" POSTGRES_PASSWORD "$PG_PASS"
set_env "$TRENDS_ENV" DATABASE_URL "postgresql://trends:$PG_PASS@postgres:5432/trends"

# The dashboard gets the keys directly, so Bot Buddy and UEFN Trends work without typing anything in Setup.
set_env "$DASH_ENV" PUBLIC_URL "https://$DOMAIN/dashboard"
set_env "$DASH_ENV" BUDDY_URL "http://127.0.0.1:3000"
set_env "$DASH_ENV" BUDDY_API_KEY "$BUDDY_KEY"
set_env "$DASH_ENV" BUDDY_WEBHOOK_SECRET "$HOOK_SECRET"
set_env "$DASH_ENV" UEFN_TRENDS_URL "http://127.0.0.1:3100"
set_env "$DASH_ENV" UEFN_TRENDS_ADMIN_KEY "$TRENDS_KEY"
chmod 600 "$BUDDY_ENV" "$TRENDS_ENV" "$DASH_ENV"

# ---------------------------------------------------------------- website + HTTPS
say "Setting up https://$DOMAIN"
mkdir -p /var/www/euphoriax
[ -f /var/www/euphoriax/index.html ] || cat > /var/www/euphoriax/index.html <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Euphoriax</title><style>body{margin:0;display:grid;place-items:center;height:100vh;font:600 14px system-ui;letter-spacing:.3em;background:#fff;color:#000}</style>
</head><body>EUPHORIAX</body></html>
HTML
cat > /etc/caddy/Caddyfile <<CADDY
# Managed by scripts/server-setup.sh
$DOMAIN {
	encode zstd gzip

	handle /dashboard* {
		request_body {
			max_size 4GB
		}
		reverse_proxy 127.0.0.1:3200
	}

	# The website. Put the files in /var/www/euphoriax.
	handle {
		root * /var/www/euphoriax
		file_server
	}
}

www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}
CADDY
systemctl reload caddy || systemctl restart caddy

# ---------------------------------------------------------------- start
say "Building and starting everything (first time takes a few minutes)"
(cd "$ROOT/uefn-trends" && docker compose up -d --build)
(cd "$ROOT/bot-buddy" && mkdir -p data && chown 1000:1000 data && docker compose up -d --build)
(cd "$ROOT/dashboard" && docker compose up -d --build)

# The Update / Restart buttons in the dashboard (and /opt/euphoriax/update.sh) run through this helper.
bash "$ROOT/dashboard/scripts/install-control.sh" >/dev/null

sleep 10
say "Status"
for url in "http://127.0.0.1:3100/health UEFN-Trends" "http://127.0.0.1:3000/health Bot-Buddy" "http://127.0.0.1:3200/dashboard/health Dashboard"; do
  set -- $url
  if curl -fsS -m 5 "$1" >/dev/null 2>&1; then echo "  ● $2 is running"; else echo "  ✕ $2 is not answering yet (check: cd $ROOT/${2,,} && docker compose logs --tail 50)"; fi
done

cat <<DONE

Done! Next:
  1. Open https://$DOMAIN/dashboard and create both logins.
  2. In the dashboard: Build queue → Download start file → double-click it on the build PC.
  3. Bot Buddy has more Discord settings (support channels, ticket category, ...):
       nano $BUDDY_ENV   then   cd $ROOT/bot-buddy && docker compose up -d

Update or restart later with the buttons in the dashboard (Status → Server),\nor on the server:   $ROOT/update.sh
DONE
