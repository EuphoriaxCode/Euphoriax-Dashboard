// Fills the database with realistic fake data so you can see the dashboard before connecting anything.
// Usage: npm run seed:demo   (uses DATA_DIR, default ./data)
import { db, kvSet, logActivity, now, recordMetric, upsertContent } from '../src/db.js';
import { addJob } from '../src/jobs.js';
import { setServiceStatus } from '../src/monitor.js';

const DAY = 864e5;
const t = now();
const rand = (a: number, b: number) => Math.round(a + Math.random() * (b - a));

const titles = [
  'I made a Daily Reward system in UEFN', 'Tycoon UI in 60 seconds', 'Fortnite extraction map but it’s AI built',
  'This UEFN inventory system is free', 'Rating every Fortnite tycoon', 'Verse tip: tween anything',
  'Brainrot obby in UEFN', 'Custom shop UI for your map', 'How we make $ with UEFN systems', 'Making a quest board',
];
const platforms = ['tiktok', 'youtube', 'instagram', 'twitter'];

for (let d = 30; d >= 0; d--) {
  const ts = t - d * DAY;
  recordMetric('youtube', 'subscribers', 4200 + (30 - d) * rand(15, 40), ts);
  recordMetric('tiktok', 'followers', 12800 + (30 - d) * rand(60, 160), ts);
  recordMetric('instagram', 'followers', 2300 + (30 - d) * rand(5, 20), ts);
  recordMetric('twitter', 'followers', 900 + (30 - d) * rand(1, 6), ts);
  recordMetric('patreon', 'patrons', 140 + (30 - d) * rand(0, 3), ts);
  recordMetric('patreon', 'monthly_revenue_cents', 98000 + (30 - d) * rand(500, 2500), ts);
  recordMetric('discord', 'members', 3100 + (30 - d) * rand(8, 25), ts);
  recordMetric('discord', 'online', rand(180, 420), ts);
}

titles.forEach((title, i) => {
  for (const p of platforms) {
    if (Math.random() < 0.25) continue;
    const published = t - (i * 1.5 + Math.random()) * DAY;
    const hit = i === 0 || i === 6 ? 8 : 1;
    let views = 0;
    for (let s = 8; s >= 0; s--) {
      const ts = t - s * DAY;
      if (ts < published) continue;
      views += rand(300, 9000) * hit * (p === 'tiktok' ? 3 : 1);
      db.prepare('INSERT INTO content_snapshots (content_id, ts, views, likes) VALUES (?, ?, ?, ?)').run(`${p}:demo${i}`, ts, views, Math.round(views * 0.06));
    }
    upsertContent({ platform: p, nativeId: `demo${i}`, title, url: 'https://euphoriax.net', publishedAt: published,
      views, likes: Math.round(views * 0.07), comments: Math.round(views * 0.004), shares: Math.round(views * 0.01) });
  }
});

const tiers = [['Starter', 500, 88], ['Creator', 1000, 41], ['Studio', 2500, 14], ['All Systems Pack', 4900, 6]] as const;
for (const [name, price, members] of tiers) {
  db.prepare(`INSERT OR REPLACE INTO products (id, platform, name, price_cents, members, revenue_cents, updated_at) VALUES (?, 'patreon', ?, ?, ?, ?, ?)`)
    .run(`patreon:${name}`, name, price, members, price * members, t);
}
for (let i = 0; i < 25; i++) {
  const [name, price] = tiers[rand(0, 3)];
  db.prepare('INSERT INTO sales (platform, product, amount_cents, event, customer, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run('patreon', name, price, 'members:pledge:create', `c${i}`, t - rand(0, 14 * 24) * 36e5);
}

const asks = [
  ['request', 'can you make a pet system like in grow a garden?'], ['request', 'need a tycoon conveyor + upgrade UI please'],
  ['question', 'how do I install the daily reward system in my map?'], ['request', 'would buy a battle pass system for uefn'],
  ['feedback', 'the shop UI is amazing but needs controller support'], ['request', 'pet system with eggs and rarity pls'],
  ['question', 'does the inventory work with save data / persistence?'], ['request', 'brainrot themed obby kit'],
  ['request', 'quest board with daily quests'], ['question', 'is there a tutorial for the tween engine?'],
  ['request', 'battle pass with tiers and rewards'], ['request', 'pet system that follows you'],
];
for (let i = 0; i < 60; i++) {
  const [kind, text] = asks[i % asks.length];
  db.prepare('INSERT INTO signals (source, kind, author, channel, text, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run('discord', kind, `user${rand(1, 400)}`, kind === 'question' ? 'help' : 'requests', text, t - rand(0, 6 * 24) * 36e5);
}

db.prepare(`INSERT OR REPLACE INTO trends_cache (key, json, ts) VALUES ('top', ?, ?)`).run(JSON.stringify({
  updatedAt: new Date().toISOString(),
  topTrends: [
    { rank: 1, slug: 'pets', name: 'Pet collecting', score: 88, arrow: '↑', lifecycle: 'ACCELERATING', opportunityScore: 82, platforms: ['roblox', 'fortnite', 'reddit'] },
    { rank: 2, slug: 'extraction', name: 'Extraction', score: 79, arrow: '↑', lifecycle: 'EMERGING', opportunityScore: 71, platforms: ['steam', 'fortnite'] },
    { rank: 3, slug: 'tycoon', name: 'Tycoon', score: 66, arrow: '→', lifecycle: 'MATURE', opportunityScore: 54, platforms: ['roblox', 'fortnite'] },
    { rank: 4, slug: 'brainrot', name: 'Brainrot', score: 61, arrow: '↓', lifecycle: 'PEAKING', opportunityScore: 40, platforms: ['kym', 'reddit', 'roblox'] },
  ],
  breakouts: [{ name: 'Garden sim', platform: 'roblox', score: 91 }],
  memes: [{ name: 'Tung tung sahur', score: 58 }],
}), t);

const services: [string, string, 'online' | 'offline' | 'degraded', string, string][] = [
  ['bot:Support bot', 'heartbeat', 'online', 'answered 34 questions today', 'Support bot'],
  ['bot:Scraper bot', 'heartbeat', 'online', 'idle', 'Scraper bot'],
  ['http:euphoriax.net', 'http', 'online', '200 in 180ms', 'euphoriax.net'],
  ['connector:uefn', 'connector', 'online', '4 top trends', 'UEFN Trends'],
  ['machine:build-pc', 'machine', 'online', 'building', 'build-pc'],
  ['bot:Ticket bot', 'heartbeat', 'offline', 'no heartbeat for 5+ min', 'Ticket bot'],
];
for (const [name, kind, status, detail, label] of services) setServiceStatus(name, kind, status, detail, label);

const reportJson = {
  headline: 'Pet systems are the #1 ask - build a Pet System before the trend peaks',
  summary: 'TikTok carried 70% of views this week; the Daily Reward video is the outlier. Discord asked for a pet system 15+ times, and UEFN Trends shows pet collecting accelerating on Roblox and Fortnite.',
  working: ['"I made a Daily Reward system" - 8x the average views on TikTok', 'Creator tier ($10) is converting best: +9 members this week'],
  notWorking: ['X posts get <2% of total views - post there only when it costs nothing', 'Long tutorial titles underperform short hook titles'],
  audienceWants: ['Pet system with eggs + rarity (15 mentions)', 'Battle pass (8)', 'Controller support for shop UI (3)'],
  marketSignals: ['Pet collecting accelerating on Roblox and Fortnite discovery', 'Extraction maps emerging on Steam + Fortnite'],
  todayFocus: ['Queue the Pet System build', 'Post a teaser of the pet egg hatch', 'Add controller support to the shop UI'],
  ideas: [],
};
const rid = Number(db.prepare(`INSERT INTO reports (ts, status, summary, json, cost_usd) VALUES (?, 'done', ?, ?, 0.41)`)
  .run(t - 3 * 36e5, reportJson.headline, JSON.stringify(reportJson)).lastInsertRowid);
const ideas = [
  ['system', 'Pet System (eggs, rarity, follow)', 'Top Discord ask + accelerating trend', 'Build a UEFN pet system: egg hatch UI with rarity roll, pets follow the player, inventory widget, Verse persistence. Follow MCP_RULES.md. Screenshot every UI state.', null, 92],
  ['video', 'Egg hatch reveal teaser', 'Hook-first teaser for the pet system', null, 'POV: you hatch a LEGENDARY pet in Fortnite 🥚✨ #uefn #fortnite #fortnitecreative', 84],
  ['system', 'Battle Pass system', 'Asked 8 times; sells well as a bundle', 'Build a UEFN battle pass: 30 tiers, free + premium tracks, XP from events, claim UI, Verse persistence.', null, 77],
  ['product', 'Bundle: Pets + Daily Reward', 'Bundles raise average order value', null, null, 63],
];
for (const [type, title, why, prompt, caption, score] of ideas) {
  db.prepare('INSERT INTO ideas (report_id, ts, type, title, why, prompt, caption, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(rid, t - 3 * 36e5, type, title, why, prompt, caption, score);
}

const j1 = addJob('Shop UI: controller support', 'Add controller/gamepad navigation to the shop UI widget...', 'demo');
db.prepare(`UPDATE jobs SET status = 'running', machine = 'build-pc', started_at = ?, log = ? WHERE id = ?`)
  .run(t - 25 * 6e4, '> Reading MCP_RULES.md\n> Opening WBP_Shop\n> Adding focus navigation rules...\n', j1);
addJob('Quest board with daily quests', 'Build a quest board...', 'demo');
const j3 = addJob('Inventory: save data', 'Add persistence to inventory...', 'demo');
db.prepare(`UPDATE jobs SET status = 'done', started_at = ?, finished_at = ?, summary = ? WHERE id = ?`)
  .run(t - 30 * 36e5, t - 28 * 36e5, 'Inventory now persists with Verse weak_map. 4 screenshots attached in the project folder.', j3);

db.prepare(`INSERT INTO posts (created_at, created_by, title, caption, platforms, scheduled_at, status) VALUES (?, 'demo', ?, ?, ?, ?, ?)`)
  .run(t, 'Tween engine in 30s', 'Animate anything in UEFN 👀 #uefn', 'tiktok,youtube,instagram', t + 5 * 36e5, 'scheduled');
db.prepare(`INSERT INTO posts (created_at, created_by, title, caption, platforms, scheduled_at, status, results_json) VALUES (?, 'demo', ?, ?, ?, ?, ?, ?)`)
  .run(t - DAY, 'Daily Reward system', 'Free daily rewards for your map 🎁', 'tiktok,youtube,instagram,twitter', t - DAY, 'published',
    JSON.stringify({ tiktok: { status: 'published' }, youtube: { status: 'published' }, instagram: { status: 'published' }, twitter: { status: 'published' } }));

const iso = (msAgo: number) => new Date(t - msAgo).toISOString();
kvSet('buddy_cache', {
  ts: t,
  status: { status: 'healthy', bots: { founderA: { connected: true, latencyMs: 42 }, founderB: { connected: true, latencyMs: 51 } },
    ai: { healthy: true, callsToday: 31, estimatedCostToday: 0.012 }, tickets: { open: 1 }, unresolved: 2, moderationActionsToday: 7 },
  personas: [{ id: 'FOUNDER_A', displayName: 'Founder A' }, { id: 'FOUNDER_B', displayName: 'Founder B' }],
  unresolved: [
    { id: 'demo-q1', username: 'kevin', question: 'Does the pet system save progress between sessions?', reason: 'NO_KNOWLEDGE', createdAt: iso(40 * 6e4), conversationContext: null },
    { id: 'demo-q2', username: 'lisa', question: 'Is there a discount if I buy the bundle?', reason: 'SENSITIVE_REQUEST', createdAt: iso(3 * 36e5), conversationContext: null },
  ],
  tickets: [{ id: 'demo-t1', ticketNumber: 14, category: 'purchase', status: 'OPEN', summary: 'Paid on Patreon, no Discord role yet', createdAt: iso(5 * 36e5) }],
  proposals: [{ id: 'demo-p1', question: 'How do I install the Daily Reward system?', answer: 'Drag the device into your level, link the widget, then push changes.' }],
});
kvSet('demo', true);
logActivity('Demo data loaded', 'demo');
console.log('Demo data loaded.');
