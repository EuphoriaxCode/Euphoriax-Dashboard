# Euphoriax HQ (dashboard)

Our private control panel. Open it in the morning and see **what needs you, what's working, and what to make next**.
Black and white, no frills.

- **Needs you** (top of the page): Discord questions the bots couldn't answer (type the answer, the bot posts it), knowledge
  the bots want to learn, failed builds, posts to do. Empty = nothing to do.
- **Incoming**: views per video, Patreon sales, Discord (bots, tickets, questions), what people say, UEFN trends, growth.
- **AI**: a daily report with ideas. One click sends an idea to the build PC or turns it into a post.
- **Outgoing**: upload a video, get captions per platform, schedule it. **Build queue**: prompts the UEFN build PC works through.
- **Status**: every bot, trend source, the build PC and every connection: online or offline. You get a Discord ping when something goes down.

It plugs into what we already have:

| Ours | How it connects |
|---|---|
| [Discord-Bot-Buddy](https://github.com/EuphoriaxCode/Discord-Bot-Buddy) | Reads its dashboard API: bot status, unanswered questions (you answer from here), tickets, knowledge proposals, real user questions for the AI. Optional webhook for instant updates. |
| [UEFN-Trends](https://github.com/EuphoriaxCode/UEFN-Trends) | Top trends, breakouts, memes, daily trend report, health of each source. "Track" and "Fresh trend report" buttons. |
| [UEFN-MCP-Guidelines](https://github.com/EuphoriaxCode/UEFN-MCP-Guidelines) | Every build prompt tells Claude on the build PC to follow `MCP_RULES.md` first. |
| Claude subscription | The build PC runs prompts (and by default also the daily analysis) with Claude Code. No API key needed. |

## Install (on the VPS where Bot Buddy and UEFN Trends run)

```bash
git clone https://github.com/EuphoriaxCode/Euphoriax-Dashboard && cd Euphoriax-Dashboard
docker compose up -d
```

Add the block from `Caddyfile.example` to the euphoriax.net Caddy config (or use the nginx snippet below), then:

1. Open **https://euphoriax.net/dashboard** and create both logins (first visit only).
2. Go to **Setup**. Bot Buddy and UEFN Trends are found automatically when they run on the same server. Paste Bot Buddy's
   `DASHBOARD_API_KEY`, press **Test**, done. Add other platforms whenever you want; each starts working when you save.
3. On the build PC: **Build queue → Download start file**, put it in the UEFN project folder, double-click.
   (Once: install Node.js and log in to Claude by running `claude` in a terminal.)

That's it. No `.env` editing, no restarts.

<details><summary>nginx instead of Caddy</summary>

```nginx
location /dashboard/ {
    proxy_pass http://127.0.0.1:3200;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    client_max_body_size 4g;
    proxy_request_buffering off;
}
```
</details>

<details><summary>Run without Docker / try it locally</summary>

Needs Node 22.13+.

```bash
npm install
npm run seed:demo     # optional: fake data to look around
npm run dev           # http://localhost:3200 → create logins
```

Production without Docker: `npm run build && BASE_PATH=/dashboard npm start`.
</details>

## Security

Name + password login (scrypt, signed httpOnly cookie, 8 tries per 15 min), `noindex`, keys for bots and the build PC are
generated automatically, the Bot Buddy key never reaches the browser, uploaded videos are only reachable when logged in
or through a signed link that expires after 72 h (for the publisher). The container only listens on 127.0.0.1; HTTPS comes from Caddy.

The build PC runs Claude Code unattended with `--dangerously-skip-permissions` (it can't click "allow"), so it can do
anything on that PC. Only queue prompts you trust. See `machine/README.md` to narrow it.

## For our own scripts

With the key from Setup → "Keys for other tools" (header `x-api-key`):
`POST /api/ingest/heartbeat {"name"}` · `POST /api/ingest/signal {"kind","text"}` · `POST /api/ingest/sale {"product","amount_cents"}` · `POST /api/ingest/metric {"platform","key","value"}`.

How it works and why: [docs/PLAN.md](docs/PLAN.md).

## Code map

```
src/index.ts          server, first-run accounts, login, media, worker download
src/settings.ts       Setup page settings (stored in the db), auto-generated keys, auto-detect
src/routes/           dashboard API (login) + bots / build PC / webhooks (keys)
src/connectors/       buddy (Discord-Bot-Buddy), uefnTrends, youtube, tiktok, instagram, twitter, patreon, discord
src/ai/               daily analysis (build PC or Claude API) + caption writer
src/outgoing/         publisher (manual | ayrshare | webhook)
src/jobs.ts           build queue (builds + daily analysis jobs)
src/monitor.ts        online/offline tracking + Discord pings
src/scheduler.ts      2-min Discord, hourly collect, 1-min checks, 30-s publish, daily AI
public/               the page (plain HTML/CSS/JS)
machine/worker.mjs    runs on the build PC (downloaded fresh by the start file)
```
