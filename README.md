# Euphoriax HQ (dashboard)

Our private control panel: **Incoming** (views, sales, Discord asks, UEFN trends), a **daily AI report** with ideas,
and **Outgoing** (multi-platform video posting + the UEFN build-machine queue). Black and white, no frills.

How it works and why: [docs/PLAN.md](docs/PLAN.md).

| Page | What's there |
|---|---|
| Overview | KPIs, today's AI brief, ideas to decide on, build machine, top content, what's selling, UEFN trends, community asks, posts, services, activity |
| Incoming | Content & views (views gained per window), Sales, Community (Discord messages + keywords), UEFN trends, Growth (30-day charts) |
| AI | Daily report + history, ideas with one-click "build" / "post" / "dismiss", "Run analysis now" |
| Outgoing | Upload video → AI captions per platform → schedule → auto-publish; post history with per-platform result |
| Build queue | Prompt queue for the UEFN PC: reorder, cancel, live log, results, re-run |
| Status | Every bot, connector, website and machine: online / offline, last seen |
| Setup | What's connected and what still needs a key, with copy-paste examples |

## Run it

Needs Node 22.13+ (uses the built-in `node:sqlite`, no database server).

```bash
npm install
cp .env.example .env                       # fill in what you have; everything is optional except login
npm run hash-password -- tom 'password'    # put the output (both of you, comma-separated) in DASHBOARD_USERS
npm run seed:demo                          # optional: fake data to see what it looks like
npm run dev                                # http://localhost:3200
```

Production: `npm run build && npm start` (or the `Dockerfile`; mount `/data`).

## Hosting on euphoriax.net

Run it next to the website as its own process and proxy a path to it. Set `BASE_PATH=/dashboard` and
`PUBLIC_URL=https://euphoriax.net/dashboard`. nginx:

```nginx
location /dashboard/ {
    proxy_pass http://127.0.0.1:3200/dashboard/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 4g;      # video uploads
    proxy_request_buffering off;
}
```

(A subdomain like `hq.euphoriax.net` with `BASE_PATH=` empty works too.)

Security: name + password login (scrypt hashes, signed httpOnly cookie, 8 attempts per 15 min), `noindex`,
separate API keys for bots (`INGEST_KEY`) and the build PC (`MACHINE_KEY`). Uploaded videos are only reachable
when logged in or through a signed link that expires after 72 hours (for the publisher). Always serve it over HTTPS.

## Plugging things in

- **Platforms**: see the Setup page for the env var each connector needs.
- **UEFN-Trends**: `UEFN_TRENDS_URL=http://<host>:3100`. It reads `/api/v1/trends/top`, `/trends/latest`, `/reports/latest` and `/status`.
- **Bots / Discord tools** (header `x-api-key: $INGEST_KEY`):
  - `POST /api/ingest/heartbeat` `{"name":"Support bot","detail":"..."}` once a minute
  - `POST /api/ingest/signal` `{"kind":"request|question|feedback|message","author","channel","text","url"}` (or an array)
  - `POST /api/ingest/sale` `{"product","amount_cents","platform"}` · `POST /api/ingest/metric` `{"platform","key","value"}`
- **Patreon webhook**: `POST /api/webhooks/patreon` with `PATREON_WEBHOOK_SECRET`.
- **Websites to watch**: copy `config/services.example.json` to `config/services.json`.
- **Build PC**: [machine/README.md](machine/README.md).

## Code map

```
src/index.ts          server, login, media
src/routes/           dashboard API (login required) + machine/bot API (keys)
src/connectors/       youtube, tiktok, instagram, twitter, patreon, discord, uefnTrends
src/ai/               daily analysis (Claude + web search), caption writer
src/outgoing/         publisher (ayrshare | webhook | manual)
src/jobs.ts           build queue
src/monitor.ts        online/offline tracking + Discord alerts
src/scheduler.ts      hourly collect, 1-min checks, 30-s publish, daily AI
public/               the page (plain HTML/CSS/JS)
machine/worker.mjs    runs on the UEFN PC
```
