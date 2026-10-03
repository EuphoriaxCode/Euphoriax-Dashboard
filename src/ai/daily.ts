import type Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import {
  contentPerformance, latestMetrics, products, recentSales, recentSignals, signalKeywords, trends, viewsByPlatform,
} from '../data.js';
import { db, logActivity, now } from '../db.js';
import { notify } from '../notify.js';
import { claude, estimateCost, extractJson } from './client.js';

export interface DailyReport {
  headline: string;
  summary: string;
  working: string[];
  notWorking: string[];
  audienceWants: string[];
  marketSignals: string[];
  todayFocus: string[];
  ideas: {
    type: 'system' | 'video' | 'product';
    title: string; why: string; score: number;
    /** For systems: a ready-to-run prompt for the UEFN build machine. */
    buildPrompt?: string;
    /** For videos: a draft caption. */
    caption?: string;
  }[];
}

const SYSTEM = `You are the analyst for Euphoriax, a two-person student company. They build UEFN (Unreal Editor for Fortnite)
systems/maps/assets with an AI build machine (Claude + UEFN MCP), sell them on Patreon, run a Discord community, and post
short videos on TikTok, YouTube, X and Instagram. Their time is very limited, so be concrete and ruthless about priorities.

Each day you get a JSON snapshot of their numbers. Use web search to check what UEFN/Fortnite creators and players are
searching for and talking about right now (new Fortnite season/updates, popular UEFN maps and mechanics, creator
requests on Reddit/X/YouTube, Roblox/Steam trends that could become UEFN systems). Combine both.

Rules:
- Ground "working / not working" in the numbers you were given. Say which video/product and the number.
- Ideas: 6-10 total, mixed types. "system" = something the build machine can make and they can sell on Patreon.
  "video" = a short-form video to post. "product" = a Patreon tier/bundle/pricing change.
- For every "system" idea write buildPrompt: a complete, self-contained instruction for a Claude Code agent driving UEFN via
  MCP (what to build, Verse devices, UI widgets, how it should look and feel, acceptance checks, and to take screenshots).
- For every "video" idea write caption: a punchy short-form caption with 3-5 hashtags.
- score is 0-100 expected value for them (demand x fit x effort).
- Keep every list item to one or two sentences.

End your reply with a single \`\`\`json block matching this TypeScript type, and nothing after it:
{ headline: string; summary: string; working: string[]; notWorking: string[]; audienceWants: string[];
  marketSignals: string[]; todayFocus: string[];
  ideas: { type: "system"|"video"|"product"; title: string; why: string; score: number; buildPrompt?: string; caption?: string }[] }`;

export function buildSnapshot() {
  const top = trends('top')?.data;
  const pastIdeas = db.prepare(`SELECT type, title, status FROM ideas WHERE ts > ? ORDER BY ts DESC LIMIT 40`)
    .all(now() - 14 * 864e5);
  const jobs = db.prepare(`SELECT title, status, finished_at FROM jobs ORDER BY created_at DESC LIMIT 15`).all();
  return {
    date: new Date().toISOString().slice(0, 10),
    accountMetrics: latestMetrics(),
    views7dByPlatform: viewsByPlatform(7),
    topContent7d: contentPerformance({ days: 7, limit: 15 }).map((c) => ({
      platform: c.platform, title: c.title, views: c.views, gained7d: c.gained, likes: c.likes, comments: c.comments,
      publishedAt: c.published_at ? new Date(c.published_at).toISOString().slice(0, 10) : null,
    })),
    worstRecent: contentPerformance({ days: 7, limit: 1000 }).filter((c) => c.published_at > now() - 14 * 864e5).slice(-5)
      .map((c) => ({ platform: c.platform, title: c.title, views: c.views })),
    patreonProducts: products().map((p) => ({ name: p.name, priceUsd: p.price_cents / 100, members: p.members, revenueUsd: p.revenue_cents / 100 })),
    recentSales: recentSales(14).slice(0, 40).map((s) => ({ product: s.product, usd: (s.amount_cents ?? 0) / 100, event: s.event, date: new Date(s.ts).toISOString().slice(0, 10) })),
    discordKeywords7d: signalKeywords(7, 30),
    discordMessages48h: recentSignals(2, 120).map((s) => `[${s.kind}] ${s.text.slice(0, 280)}`),
    uefnTrends: top ? { topTrends: top.topTrends?.slice(0, 10), breakouts: top.breakouts?.slice(0, 8), memes: top.memes?.slice(0, 5) } : null,
    uefnTrendsReport: trends('report')?.data ?? null,
    ideasLast14d: pastIdeas,
    buildQueueRecent: jobs,
  };
}

let running = false;

export async function runDailyAnalysis(who = 'scheduler') {
  if (running) throw new Error('analysis already running');
  running = true;
  const reportId = Number(db.prepare(`INSERT INTO reports (ts, status) VALUES (?, 'running')`).run(now()).lastInsertRowid);
  logActivity('Daily AI analysis started', who);
  try {
    const snapshot = buildSnapshot();
    const messages: Anthropic.Beta.BetaMessageParam[] = [{
      role: 'user',
      content: `Today's snapshot:\n\n${JSON.stringify(snapshot)}\n\nResearch what people are searching for, then write today's report.`,
    }];
    let final: Anthropic.Beta.BetaMessage | null = null;
    let cost = 0;
    // Web search can pause a long turn; continue it until Claude finishes (bounded).
    for (let i = 0; i < 4; i++) {
      final = await claude().beta.messages.stream({
        model: config.aiModel,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: SYSTEM,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 10 }],
        messages,
      }).finalMessage();
      cost += estimateCost(config.aiModel, final.usage);
      if (final.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: final.content as Anthropic.Beta.BetaContentBlockParam[] });
    }
    if (!final) throw new Error('no response');
    if (final.stop_reason === 'refusal') throw new Error('model declined the request');

    const text = final.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
    const report = extractJson<DailyReport>(text);
    db.prepare(`UPDATE reports SET status = 'done', summary = ?, json = ?, cost_usd = ? WHERE id = ?`)
      .run(report.headline ?? report.summary ?? '', JSON.stringify(report), cost, reportId);
    const insert = db.prepare(`INSERT INTO ideas (report_id, ts, type, title, why, prompt, caption, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const idea of report.ideas ?? []) {
      insert.run(reportId, now(), idea.type, idea.title, idea.why ?? '', idea.buildPrompt ?? null, idea.caption ?? null, idea.score ?? null);
    }
    logActivity(`Daily AI analysis done: ${report.headline}`, who);
    await notify(`🧠 **Daily report ready** - ${report.headline}\nTop idea: ${report.ideas?.[0]?.title ?? '-'}\n${config.publicUrl}/#ai`);
    return reportId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(`UPDATE reports SET status = 'failed', error = ? WHERE id = ?`).run(msg, reportId);
    logActivity(`Daily AI analysis failed: ${msg.slice(0, 160)}`, who);
    throw err;
  } finally {
    running = false;
  }
}
