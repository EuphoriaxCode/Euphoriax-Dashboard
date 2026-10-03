# Euphoriax HQ: how it works

One private page that answers three questions every morning:
**Is everything running? What is working? What do we make next?**

```
                 INCOMING                                 BRAIN                         OUTGOING
 YouTube / TikTok / IG / X  ── views, followers ─┐
 Patreon (API + webhooks)   ── tiers, sales  ────┤                               ┌─► Upload zone ─► Ayrshare / n8n ─► TikTok, YT, IG, X
 Discord tools              ── requests, Qs  ────┼─► SQLite ─► Daily AI report ──┤      (AI writes captions per platform)
 UEFN-Trends engine         ── trends, report ───┤   (snapshots)  + web search   └─► Build queue ─► UEFN PC worker ─► Claude Code + MCP
 Bots / websites            ── heartbeats ───────┘                     ideas ─────────────────────────────▲   (your subscription)
                                                                                                          └─ Discord ping when done
```

## Connected to what we already have
- **Discord-Bot-Buddy** → bot status, unanswered questions (answer from the dashboard; the bot posts it and can remember it),
  tickets, knowledge proposals, and the real questions people ask (fed to the daily AI).
- **UEFN-Trends** → trends, breakouts, memes, the trend report and the health of each source. Buttons to track something or ask for a fresh report.
- **UEFN-MCP-Guidelines** → the preamble of every build prompt.
- **Claude subscription** → the build PC runs builds and the daily analysis, so no API key is needed.

## Incoming zone
- **Connectors** pull every hour: per-video views/likes/comments (YouTube, TikTok, Instagram, X), followers,
  Patreon tiers + members + monthly revenue, Discord member counts, UEFN-Trends `/trends/top`, `/latest`, `/reports/latest`.
- Every pull stores a **snapshot**, so "what is getting views" means *views gained in the window*. A two-week-old video
  that suddenly gets views again shows up.
- **Discord tools push** what people ask for to `/api/ingest/signal` (request / question / feedback). The dashboard counts
  keywords live, and the AI clusters them daily.
- **Sales** come from the Patreon webhook (new pledge, upgrade, cancel) plus `/api/ingest/sale` for anything else.

## Brain (daily AI)
Every morning (default 07:00) Claude gets one compact JSON snapshot: top and worst content, platform totals,
tier sales, Discord asks, UEFN trends and last week's ideas. It also **web-searches** what UEFN/Fortnite players and creators
are looking for right now. It returns:
- headline + summary, *working / not working* (with numbers), *people want*, *market signals*, *focus today*
- 6-10 scored **ideas**: `system` (comes with a ready build prompt), `video` (comes with a caption), `product` (tier/bundle/pricing)

Each idea is one click: **Send to build queue**, **Make this post** or **Dismiss**. What you pick or dismiss goes back into the
next day's prompt, so the ideas follow your taste over time. Cost is one call a day (about $0.30-1).

## Outgoing zone
- **Upload**: drop the video, give it a title, press "Write captions with AI" (per-platform captions + YouTube title),
  choose platforms and a time. The scheduler publishes when it's due.
- **Publisher** options:
  - `ayrshare` (recommended): one API for TikTok, YouTube, Instagram and X. You skip four separate developer-app reviews
    (TikTok and Instagram posting need app approval). About $50/mo.
  - `webhook`: hands the post to n8n/Make/Zapier or your own script (free, more setup).
  - `manual`: no posting; at post time you get a Discord ping, then press "Mark as posted".
- **Build queue**: prompts (yours or from AI ideas) in order, with reordering and cancel. The UEFN PC runs
  `machine/worker.mjs`, which takes the next prompt, runs it in Claude Code headless with the MCP rules preamble,
  streams the log live, and pings Discord when it finishes. When the Claude subscription limit is hit, the job goes back to
  the front of the queue and the worker waits, so the PC works through the queue whenever it is on.

## Control / status
Everything with a heartbeat or URL is on the Status page: bots, connectors, websites, the build machine, the AI and the
publisher. If something goes **offline**, you get a Discord ping and a black banner on the overview.

## Ideas for later (not built yet)
1. **Video → result loop**: link each post to the Patreon product it promotes and show "views → sales" per product.
2. **Auto-clip from builds**: the worker records the UEFN screen at the end of a build and drops a draft post into Outgoing.
3. **Discord answer bot from the dashboard**: answer FAQ from a knowledge base; unanswered questions flow into Incoming.
4. **Weekly review**: a Sunday AI report that grades last week's ideas (did they get built, did they sell?).
5. **Prompt templates**: saved build-prompt templates (UI system, Verse device, map) with fill-in fields.
6. **Second machine**: the queue already supports multiple workers; add a second PC to build twice as fast.
