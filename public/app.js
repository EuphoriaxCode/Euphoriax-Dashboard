// Euphoriax dashboard - plain JS, no build step.

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const PLATFORMS = ['tiktok', 'youtube', 'instagram', 'twitter'];
const PLATFORM_NAMES = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', twitter: 'X', patreon: 'Patreon', discord: 'Discord' };

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
  return Math.round(n).toLocaleString('en-US');
};
const money = (cents) => '$' + Math.round((cents ?? 0) / 100).toLocaleString('en-US');
const signed = (n) => (n === null || n === undefined ? '' : (n >= 0 ? '+' : '') + fmt(n));
const ago = (ts) => {
  if (!ts) return 'never';
  const s = (Date.now() - ts) / 1000;
  const fut = s < 0;
  const a = Math.abs(s);
  const t = a < 60 ? `${Math.round(a)}s` : a < 3600 ? `${Math.round(a / 60)}m` : a < 86400 ? `${Math.round(a / 3600)}h` : `${Math.round(a / 86400)}d`;
  return fut ? `in ${t}` : `${t} ago`;
};
const when = (ts) => ts ? new Date(ts).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
const pname = (p) => PLATFORM_NAMES[p] ?? p;

async function api(path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.headers ?? {}) } };
  if (opts.json !== undefined) {
    init.method = init.method ?? 'POST';
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.json);
  }
  const res = await fetch(path.replace(/^\//, ''), init);
  if (res.status === 401 && !path.includes('login')) { showLogin(); throw new Error('login required'); }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.append(el); }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3500);
}

/** Green pulsing dot when online, red when not. The word stays next to it so it never relies on colour alone. */
const dot = (s) => `<i class="dot ${esc(s)}"></i>`;
const statusBadge = (s, label, size = '') => {
  const text = label ?? { not_configured: 'not set up', degraded: 'slow', offline: 'offline' }[s] ?? s;
  return `<span class="status ${esc(s)} ${size}">${dot(s)}${esc(text)}</span>`;
};

function bar(value, max, tip) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return `<div class="bar" data-tip="${esc(tip ?? fmt(value))}"><span style="width:${pct}%"></span></div>`;
}

// Hover tooltips for anything with data-tip.
const tip = $('#tooltip');
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (!el) { tip.hidden = true; return; }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px';
  tip.style.top = e.clientY + 14 + 'px';
});

const empty = (text) => `<div class="empty">${text}</div>`;

// ---------- auth ----------
async function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  const state = await fetch('api/setup-state').then((r) => r.json()).catch(() => ({}));
  $('#login-form').hidden = !!state.needsAccount;
  $('#first-form').hidden = !state.needsAccount;
}
$('#first-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    await api('/api/first-account', { json: f });
    $('#login').hidden = true;
    location.hash = 'setup';
    start();
  } catch (err) {
    $('#first-error').textContent = err.message;
  }
});
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/api/login', { json: { name: f.get('name'), password: f.get('password') } });
    $('#login').hidden = true;
    start();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});
$('#logout').onclick = async () => { await api('/api/logout', { json: {} }); location.reload(); };
$('#refresh').onclick = async (e) => {
  e.target.disabled = true;
  e.target.textContent = 'Refreshing…';
  try { await api('/api/collect', { json: {} }); toast('All data refreshed'); route(); }
  catch (err) { toast(err.message); }
  finally { e.target.disabled = false; e.target.textContent = 'Refresh'; }
};

// ---------- router ----------
const pages = { overview, incoming, trends, ai, knowledge, outgoing, build, status, setup };
let timer = null;

// A page that was still loading when you clicked another tab must not draw over it (or start its timer).
const pageName = () => (location.hash.slice(1) || 'overview').split('/')[0];

// Timer-driven refreshes replace the whole view; keep the reader's scroll position.
async function keepScroll(fn) {
  const y = window.scrollY;
  try { await fn(); } finally { window.scrollTo(0, y); }
}

async function route() {
  clearInterval(timer);
  const [name, sub] = (location.hash.slice(1) || 'overview').split('/');
  const page = pages[name] ?? overview;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${name}`));
  try {
    await page(sub);
  } catch (err) {
    if (err.message !== 'login required') view.innerHTML = `<div class="card strong">Something went wrong: ${esc(err.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);

async function updateHealthPill() {
  try {
    const svcs = await api('/api/services');
  if (pageName() !== 'status') return;
    const down = svcs.filter((s) => s.status === 'offline');
    const pill = $('#health-pill');
    pill.innerHTML = `${dot(down.length ? 'offline' : 'online')}${down.length ? `${down.length} offline` : 'all systems online'}`;
    pill.className = 'pill' + (down.length ? ' bad' : '');
    pill.title = down.map((s) => s.label ?? s.name).join(', ');
  } catch { /* ignore */ }
}

async function start() {
  try { await api('/api/me'); } catch { return; }
  $('#app').hidden = false;
  route();
  updateHealthPill();
  setInterval(updateHealthPill, 60_000);
}
start();

// ======================================================================
// OVERVIEW
// ======================================================================
async function overview() {
  const d = await api('/api/overview');
  if (pageName() !== 'overview') return;
  const m = d.metrics;
  const totalViews7 = Object.values(d.views7d).reduce((a, p) => a + p.gained, 0);
  const totalViews1 = Object.values(d.views1d).reduce((a, p) => a + p.gained, 0);
  const fm = ['tiktok', 'youtube', 'instagram', 'twitter'].map((p) => m[p]?.followers ?? m[p]?.subscribers).filter(Boolean);
  const followers = { v: fm.reduce((n, k) => n + k.value, 0) };
  const young = fm.some((k) => k.change7d === null);   // less than a week of history for at least one platform
  followers.c = fm.reduce((n, k) => n + (k.change7d ?? k.changeAll ?? 0), 0);
  followers.label = young ? (fm.some((k) => k.changeAll !== null) ? 'since connected' : 'just connected, growth shows up soon') : 'this week';
  // "this week" / "since connected" text for a single metric
  const delta = (k, scale = 1) => !k ? '' : k.change7d !== null ? `${signed(k.change7d / scale)} this week` : k.changeAll !== null ? `${signed(k.changeAll / scale)} since connected` : 'just connected';
  const totalOnVideos = Object.values(d.views7d).reduce((a, p) => a + p.total, 0);
  const viewsNote = d.historyDays < 7
    ? `collecting data: day ${Math.min(7, Math.floor(d.historyDays) + 1)} of 7${totalOnVideos ? ` · ${fmt(totalOnVideos)} views in total on your recent videos` : ''}`
    : `${fmt(totalViews1)} in last 24h`;
  const down = d.services.filter((s) => s.status === 'offline');
  const report = d.report?.json;
  const running = d.jobs.find((j) => j.status === 'running');
  const queued = d.jobs.filter((j) => j.status === 'queued');
  const machines = d.services.filter((s) => s.kind === 'machine');
  const maxContent = Math.max(1, ...d.topContent.map((c) => c.gained));

  view.innerHTML = `
    ${inboxHtml(d)}
    ${down.length ? `<div class="card strong" style="margin-bottom:16px">
      <div class="spread"><strong style="display:inline-flex;align-items:center">${dot('offline')}${down.length} service${down.length > 1 ? 's' : ''} offline:</strong>
      <span>${down.map((s) => esc(s.label ?? s.name)).join(' · ')}</span><a href="#status">See status →</a></div></div>` : ''}

    <div class="kpis">
      ${kpi('Views (7 days)', fmt(totalViews7), viewsNote)}
      ${kpi('Followers (all socials)', fmt(followers.v), young && !fm.some((k) => k.changeAll !== null) ? 'just connected: growth shows up from tomorrow' : `${signed(followers.c)} ${followers.label}`)}
      ${kpi('Patreon / month', money(m.patreon?.monthly_revenue_cents?.value), delta(m.patreon?.monthly_revenue_cents, 100).replace(/^([+-]?\d+)/, '$1 $'))}
      ${kpi('Patrons', fmt(m.patreon?.patrons?.value), delta(m.patreon?.patrons))}
      ${kpi('Sales (7 days)', money(d.sales7d.cents), `${d.sales7d.n} sales`)}
      ${kpi('Discord members', fmt(m.discord?.members?.value), `${fmt(m.discord?.online?.value)} online · ${d.signals24h} msgs/24h`)}
    </div>

    <div class="grid g3">
      <div class="card strong span2">
        <div class="spread"><h2>Today · AI brief</h2>
          <span class="small muted">${d.report ? `${ago(d.report.ts)}` : ''} · <a href="#ai">Full report</a></span></div>
        ${report ? `
          <div class="headline">${esc(report.headline)}</div>
          <p class="muted">${esc(report.summary)}</p>
          <div class="grid g2">
            <div><h3>Focus today</h3><ul class="bullets">${(report.todayFocus ?? []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
            <div><h3>People want</h3><ul class="bullets">${(report.audienceWants ?? []).slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
          </div>` : empty(d.lastRun?.status === 'failed' ? `Last analysis failed: ${esc(d.lastRun.error)}` : 'No AI report yet. Go to <a href="#ai">AI</a> and press "Run analysis now".')}
      </div>

      <div class="card">
        <div class="spread"><h2>Build machine</h2><a class="small" href="#build">Queue →</a></div>
        ${machines.length ? machines.map((s) => `<div class="spread"><strong>${esc(s.label ?? s.name)}</strong>${statusBadge(s.status)}</div>`).join('') : `<div class="muted small">No machine has connected yet.</div>`}
        <div style="margin-top:12px">
          ${running ? `<div class="small muted">Building now · started ${ago(running.started_at)}</div><div><strong>${esc(running.title)}</strong></div>` : '<div class="muted">Idle</div>'}
        </div>
        <div class="small muted" style="margin-top:12px">Up next (${queued.length})</div>
        <ol style="margin:4px 0 0;padding-left:18px">${queued.slice(0, 4).map((j) => `<li>${esc(j.title)}</li>`).join('') || '<li class="muted">Queue empty</li>'}</ol>
      </div>
    </div>

    <h2 class="section-title">Ideas waiting for a decision</h2>
    ${d.ideas.length ? `<div class="grid g3">${d.ideas.map(ideaCard).join('')}</div>` : empty('No new ideas. They come in with each daily AI report.')}

    <div class="grid g2" style="margin-top:16px">
      <div class="card">
        <div class="spread"><h2>What's getting views · 7 days</h2><a class="small" href="#incoming/content">All content →</a></div>
        <div class="table-wrap"><table>
          <tr><th>Content</th><th></th><th class="num">+Views</th><th class="num">Total</th></tr>
          ${d.topContent.map((c) => `<tr>
            <td class="title"><span class="tag">${pname(c.platform)}</span><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>
              ${bar(c.gained, maxContent, `${fmt(c.gained)} views gained in 7 days`)}</td><td></td>
            <td class="num">${fmt(c.gained)}</td><td class="num muted">${fmt(c.views)}</td></tr>`).join('') || `<tr><td colspan="4">${empty('No content data yet.')}</td></tr>`}
        </table></div>
        <h3 style="margin-top:14px">Views by platform · 7 days</h3>
        ${platformBars(d.views7d)}
      </div>

      <div class="card">
        <div class="spread"><h2>What's selling · 30 days</h2><a class="small" href="#incoming/sales">Sales →</a></div>
        ${d.topProducts.length ? d.topProducts.map((v) => `<div class="bar-row"><span>${esc(v.product)}</span>${bar(v.cents, Math.max(...d.topProducts.map((x) => x.cents)), `${v.n} sales · ${money(v.cents)}`)}<span class="num">${money(v.cents)}</span></div>`).join('')
          : empty('No sales yet. <a href="#incoming/sales">Import your Patreon sales</a> (the shop has no live feed).')}
        ${d.products.length ? `<h3 style="margin:12px 0 6px">Membership tiers</h3>${productTable(d.products)}` : ''}
        <div class="spread" style="margin-top:16px"><h2>UEFN trends</h2><a class="small" href="#incoming/trends">Trends →</a></div>
        ${trendTable(d.trends?.data?.topTrends?.slice(0, 5))}
      </div>

      <div class="card">
        <div class="spread"><h2>Community asks · 7 days</h2><a class="small" href="#incoming/community">Messages →</a></div>
        ${keywordBars(d.keywords)}
      </div>

      <div class="card">
        <div class="spread"><h2>Outgoing posts</h2><a class="small" href="#outgoing">Upload →</a></div>
        ${postList(d.posts)}
      </div>

      <div class="card">
        <div class="spread"><h2>Services</h2><a class="small" href="#status">All →</a></div>
        <div class="svc-grid">${d.services.filter((s) => s.status !== 'not_configured').map(svcCard).join('') || empty('Nothing reporting yet.')}</div>
      </div>

      <div class="card">
        <h2 style="margin-bottom:8px">Activity</h2>
        <ul class="list small">${d.activity.map((a) => `<li class="spread"><span>${esc(a.text)}</span><span class="muted">${esc(a.who ?? '')} · ${ago(a.ts)}</span></li>`).join('') || `<li class="muted">Nothing yet</li>`}</ul>
      </div>
    </div>`;
  bindIdeaButtons();
  bindInbox(overview);
  // Don't refresh while someone is typing an answer.
  timer = setInterval(() => {
    const typing = document.activeElement?.tagName === 'TEXTAREA' && document.activeElement.value;
    if (!document.hidden && !typing && location.hash.replace('#', '') in { '': 1, overview: 1 }) keepScroll(overview).catch(() => {});
  }, 60_000);
}

// ---------- "Needs you" inbox: everything that waits on a human, in one place ----------
function inboxHtml(d) {
  const i = d.inbox;
  const items = [];
  for (const q of i.questions) items.push(questionItem(q));
  for (const p of i.proposals) items.push(`<div class="inbox-item" data-proposal="${esc(p.id)}">
    <div class="small muted">The bots want to learn this answer</div>
    <div><strong>${esc(p.question)}</strong></div><div class="quote">${esc(p.answer)}</div>
    <div class="row"><button class="primary" data-act="approve">Yes, remember it</button><button data-act="reject">No</button></div></div>`);
  for (const j of i.failedBuilds) items.push(`<div class="inbox-item spread" data-job="${j.id}"><div><span class="tag dark">build failed</span> <a href="#build/${j.id}"><strong>${esc(j.title)}</strong></a>
    <div class="small muted">${esc((j.summary ?? '').slice(0, 160))}</div></div><button data-act="retry">Run again</button></div>`);
  for (const p of i.postsToHandle) items.push(`<div class="inbox-item spread" data-post="${p.id}"><div><span class="tag ${p.status === 'manual' ? '' : 'dark'}">${p.status === 'manual' ? 'post this' : 'post ' + esc(p.status)}</span>
    <strong>${esc(p.title)}</strong> <span class="small muted">${p.platforms.split(',').map(pname).join(', ')}</span></div>
    <div class="row">${p.status === 'manual' && p.id ? `<a class="btn" href="media/${p.id}" target="_blank">Video</a>` : ''}<button data-act="published">Done, it's posted</button></div></div>`);
  if (i.importSalesDue) items.push(`<div class="inbox-item spread"><div><span class="tag dark">weekly</span> <strong>Import this week's Patreon shop sales</strong>
    <div class="small muted">Patreon → Audience → Sales → Download CSV, then upload it on the Sales page.</div></div><a class="btn" href="#incoming/sales">Import →</a></div>`);
  if (i.updates?.length) items.push(`<div class="inbox-item spread"><div><span class="tag dark">update</span> <strong>New version available</strong>
    <div class="small muted">${i.updates.map((u) => `${esc(u.label)} (${u.behind})`).join(' · ')}</div></div><a class="btn" href="#status">Update →</a></div>`);
  if (i.drafts) items.push(`<div class="inbox-item spread"><div><span class="tag dark">review</span> <strong>${i.drafts} new answer${i.drafts > 1 ? 's' : ''} for the Discord bots</strong>
    <div class="small muted">Pushed in by a tool. The bots only use them after you approve.</div></div><a class="btn" href="#knowledge">Review →</a></div>`);
  const extra = i.questionsTotal > i.questions.length ? `<a href="#incoming/discord">+${i.questionsTotal - i.questions.length} more questions</a>` : '';
  const tickets = i.tickets ? `<a href="#incoming/discord">${i.tickets} open ticket${i.tickets > 1 ? 's' : ''}</a>` : '';
  return `<div class="inbox">
    <div class="spread"><h2>Needs you</h2><span class="small">${[extra, tickets].filter(Boolean).join(' · ')}</span></div>
    ${items.length ? items.join('') : `<div class="ok-line" style="margin-top:8px">✓ Nothing needs you right now.</div>`}
    ${setupChecklist(d)}
  </div>`;
}

function questionItem(q) {
  return `<div class="inbox-item" data-question="${esc(q.id)}">
    <div class="spread small muted"><span><span class="tag dark">discord question</span>${esc(q.username)} · ${ago(new Date(q.createdAt).getTime())} · bot wasn't sure (${esc(String(q.reason ?? '').toLowerCase().replace(/_/g, ' '))})</span>
      ${q.link ? `<a href="${esc(q.link)}" target="_blank" rel="noopener">Open in Discord ↗</a>` : ''}</div>
    ${(q.context ?? []).filter((c) => c.text && c.text !== q.question).slice(-2).map((c) => `<div class="ctx">${esc(c.who)}: ${esc(c.text)}</div>`).join('')}
    <div class="quote"><strong>${esc(q.question)}</strong></div>
    <textarea rows="2" placeholder="Type the answer. The bot posts it in Discord for you."></textarea>
    <div class="row" style="margin-top:6px"><button class="primary" data-act="answer">Send answer</button>
      <label class="check"><input type="checkbox" data-remember checked> Bots remember this answer</label>
      <button data-act="ignore">Ignore</button></div></div>`;
}

function bindInbox(reload) {
  const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); reload(); } catch (err) { toast(err.message); } };
  view.querySelectorAll('[data-question] [data-act]').forEach((btn) => btn.onclick = () => {
    const box = btn.closest('[data-question]');
    const id = box.dataset.question;
    if (btn.dataset.act === 'ignore') return act(() => api(`/api/discord/unresolved/${id}/ignore`, { json: {} }), 'Ignored');
    const answer = box.querySelector('textarea').value.trim();
    if (!answer) return toast('Type an answer first');
    btn.disabled = true;
    act(() => api(`/api/discord/unresolved/${id}/answer`, { json: { answer, remember: box.querySelector('[data-remember]').checked } }), 'Answer posted in Discord');
  });
  view.querySelectorAll('[data-proposal] [data-act]').forEach((btn) => btn.onclick = () =>
    act(() => api(`/api/discord/proposals/${btn.closest('[data-proposal]').dataset.proposal}/${btn.dataset.act}`, { json: {} })));
  view.querySelectorAll('.inbox [data-job] [data-act]').forEach((btn) => btn.onclick = () =>
    act(() => api(`/api/jobs/${btn.closest('[data-job]').dataset.job}/retry`, { json: {} }), 'Back in the queue'));
  view.querySelectorAll('.inbox [data-post] [data-act]').forEach((btn) => btn.onclick = () =>
    act(() => api(`/api/posts/${btn.closest('[data-post]').dataset.post}/status`, { json: { status: btn.dataset.act } })));
  view.querySelectorAll('[data-ticket] [data-act]').forEach((btn) => btn.onclick = () => {
    if (confirm('Close this ticket in Discord?')) act(() => api(`/api/discord/tickets/${btn.closest('[data-ticket]').dataset.ticket}/close`, { json: {} }), 'Ticket closed');
  });
}

/** Shown until the main things are connected. */
function setupChecklist(d) {
  const has = (prefix) => d.services.some((s) => s.name.startsWith(prefix) && s.status !== 'not_configured');
  const steps = [
    ['Discord bots (Bot Buddy)', d.buddyConnected],
    ['UEFN Trends', has('connector:uefn')],
    ['Build PC', d.services.some((s) => s.kind === 'machine')],
    ['A social platform', ['youtube', 'tiktok', 'instagram', 'twitter'].some((p) => has(`connector:${p}`))],
    ['Patreon', has('connector:patreon')],
  ];
  const done = steps.filter(([, ok]) => ok).length;
  if (done === steps.length) return '';
  return `<div class="inbox-item"><div class="spread"><strong>Finish setup · ${done}/${steps.length} connected</strong><a class="btn" href="#setup">Open Setup →</a></div>
    <div class="row small" style="margin-top:6px">${steps.map(([n, ok]) => `<span>${ok ? '✓' : '○'} ${n}</span>`).join(' ')}</div></div>`;
}

const kpi = (label, value, delta) => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${delta ?? ''}</div></div>`;

function platformBars(byPlatform) {
  const rows = Object.entries(byPlatform).sort((a, b) => b[1].gained - a[1].gained);
  if (!rows.length) return empty('No data yet.');
  const max = Math.max(1, ...rows.map(([, v]) => v.gained));
  return rows.map(([p, v]) => `<div class="bar-row"><span>${pname(p)}</span>${bar(v.gained, max, `${pname(p)}: ${fmt(v.gained)} views over ${v.posts} posts`)}<span class="num">${fmt(v.gained)}</span></div>`).join('');
}

function keywordBars(words) {
  if (!words?.length) return empty('No Discord messages yet. Point your Discord tools at /api/ingest/signal.');
  const max = Math.max(...words.map((w) => w.count));
  return words.map((w) => `<div class="bar-row"><span>${esc(w.word)}</span>${bar(w.count, max, `"${w.word}" in ${w.count} messages`)}<span class="num">${w.count}</span></div>`).join('');
}

function productTable(products) {
  if (!products?.length) return empty('No products yet. Connect Patreon in Setup.');
  const max = Math.max(1, ...products.map((p) => p.revenue_cents));
  return `<div class="table-wrap"><table><tr><th>Tier / product</th><th class="num">Price</th><th class="num">Members</th><th class="num">Revenue/mo</th></tr>
    ${products.map((p) => `<tr><td class="title">${esc(p.name)}${bar(p.revenue_cents, max, `${money(p.revenue_cents)} / month`)}</td>
      <td class="num">${money(p.price_cents)}</td><td class="num">${fmt(p.members)}</td><td class="num">${money(p.revenue_cents)}</td></tr>`).join('')}
  </table></div>`;
}

function trendTable(trends) {
  if (!trends?.length) return empty('No trend data. Set UEFN_TRENDS_URL in Setup.');
  return `<div class="table-wrap"><table><tr><th>#</th><th>Trend</th><th>Stage</th><th class="num">Momentum</th><th class="num">UEFN fit</th></tr>
    ${trends.map((t) => `<tr><td class="muted">${String(t.rank).padStart(2, '0')}</td><td><strong>${esc(t.name)}</strong> ${esc(t.arrow ?? '')}
      <div class="small muted">${(t.platforms ?? []).map(esc).join(' · ')}</div></td>
      <td><span class="tag">${esc(t.lifecycle ?? '')}</span></td><td class="num">${t.score ?? '-'}</td><td class="num">${t.opportunityScore ?? '-'}</td></tr>`).join('')}
  </table></div>`;
}

function postList(posts) {
  if (!posts?.length) return empty('Nothing scheduled.');
  return `<ul class="list">${posts.map((p) => `<li class="spread"><div><strong>${esc(p.title)}</strong>
    <div class="small muted">${p.platforms.split(',').map(pname).join(' · ')} · ${when(p.scheduled_at)}</div></div>
    <span class="tag ${p.status === 'failed' ? 'dark' : ''}">${esc(p.status)}</span></li>`).join('')}</ul>`;
}

const svcCard = (s) => `<div class="svc ${esc(s.status)}" data-tip="${esc(s.detail ?? '')}">
  <div class="spread"><span class="name">${esc(s.label ?? s.name)}</span>${statusBadge(s.status)}</div>
  <div class="detail">${esc(s.detail ?? '')}</div>
  <div class="detail">${s.kind} · ${s.last_seen ? `seen ${ago(s.last_seen)}` : 'never seen'}</div></div>`;

function ideaCard(i) {
  return `<div class="idea" data-idea="${i.id}">
    <div class="spread"><span><span class="tag dark">${esc(i.type)}</span><span class="small muted">${ago(i.ts)}</span></span>
      <span class="score" data-tip="Expected value score from the AI (0-100)">${i.score ?? '-'}</span></div>
    <h3 style="margin:6px 0 4px">${esc(i.title)}</h3>
    <div class="small muted">${esc(i.why ?? '')}</div>
    ${i.prompt ? `<details style="margin-top:6px"><summary>Build prompt</summary><div class="mono log" style="margin-top:6px">${esc(i.prompt)}</div></details>` : ''}
    ${i.caption ? `<details style="margin-top:6px"><summary>Caption</summary><div style="margin-top:6px">${esc(i.caption)}</div></details>` : ''}
    <div class="row" style="margin-top:10px">
      ${i.status === 'new' ? `
        ${i.type === 'system' ? `<button class="primary" data-act="queue">Send to build queue</button>` : ''}
        ${i.type === 'video' ? `<button class="primary" data-act="post">Make this post</button>` : ''}
        ${i.type === 'product' ? `<button data-act="done">Done</button>` : ''}
        <button data-act="dismiss">Dismiss</button>` : `<span class="tag">${esc(i.status)}</span>`}
    </div></div>`;
}

function bindIdeaButtons() {
  view.querySelectorAll('[data-idea] [data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const card = btn.closest('[data-idea]');
      const id = card.dataset.idea;
      const act = btn.dataset.act;
      try {
        if (act === 'queue') { await api(`/api/ideas/${id}/queue`, { json: {} }); toast('Added to the build queue'); }
        if (act === 'dismiss') await api(`/api/ideas/${id}`, { json: { status: 'dismissed' } });
        if (act === 'done') await api(`/api/ideas/${id}`, { json: { status: 'posted' } });
        if (act === 'post') {
          const ideas = await api('/api/ideas');
          const idea = ideas.find((x) => String(x.id) === id);
          sessionStorage.setItem('prefillPost', JSON.stringify({ title: idea.title, caption: idea.caption ?? '', idea_id: idea.id }));
          location.hash = 'outgoing';
          return;
        }
        route();
      } catch (err) { toast(err.message); }
    };
  });
}

// ======================================================================
// INCOMING
// ======================================================================
async function incoming(sub = 'content') {
  const tabs = [['content', 'Content & views'], ['sales', 'Sales'], ['discord', 'Discord'], ['community', 'What people say'], ['trends', 'UEFN trends'], ['growth', 'Growth']];
  view.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button class="${k === sub ? 'active' : ''}" onclick="location.hash='incoming/${k}'">${l}</button>`).join('')}</div><div id="sub"></div>`;
  const el = $('#sub');
  if (sub === 'content') return contentPage(el);
  if (sub === 'sales') return salesPage(el);
  if (sub === 'community') return communityPage(el);
  if (sub === 'discord') return discordPage(el);
  if (sub === 'trends') return trendsPage(el);
  if (sub === 'growth') return growthPage(el);
}

async function contentPage(el, days = 7, platform = '') {
  const d = await api(`/api/content?days=${days}&platform=${platform}`);
  const max = Math.max(1, ...d.items.map((c) => c.gained));
  el.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <select id="days" style="width:auto">${[1, 7, 30, 90].map((n) => `<option value="${n}" ${n === days ? 'selected' : ''}>Last ${n} day${n > 1 ? 's' : ''}</option>`).join('')}</select>
      <select id="plat" style="width:auto"><option value="">All platforms</option>${PLATFORMS.map((p) => `<option value="${p}" ${p === platform ? 'selected' : ''}>${pname(p)}</option>`).join('')}</select>
    </div>
    <div class="grid g3">
      <div class="card"><h2 style="margin-bottom:8px">Views gained by platform</h2>${platformBars(d.byPlatform)}</div>
      <div class="card span2"><h2 style="margin-bottom:8px">How to read this</h2>
        <p class="small muted" style="margin:0">"+Views" is how many views each post gained in the selected window (from hourly snapshots), so old posts that are still growing show up too.
        Engagement = (likes + comments + shares) / views. Sort is by views gained.</p></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="table-wrap"><table>
      <tr><th>Content</th><th>Posted</th><th class="num">+Views</th><th class="num">Views</th><th class="num">Likes</th><th class="num">Comments</th><th class="num">Engagement</th></tr>
      ${d.items.map((c) => `<tr>
        <td class="title"><span class="tag">${pname(c.platform)}</span><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title || '(untitled)')}</a>${bar(c.gained, max, `${fmt(c.gained)} views gained`)}</td>
        <td class="small muted" style="white-space:nowrap">${c.published_at ? ago(c.published_at) : '-'}</td>
        <td class="num"><strong>${fmt(c.gained)}</strong></td><td class="num">${fmt(c.views)}</td><td class="num">${fmt(c.likes)}</td><td class="num">${fmt(c.comments)}</td>
        <td class="num">${c.views ? (((c.likes + c.comments + c.shares) / c.views) * 100).toFixed(1) + '%' : '-'}</td></tr>`).join('') || `<tr><td colspan="7">${empty('No content yet. Connect platforms in Setup.')}</td></tr>`}
    </table></div></div>`;
  $('#days').onchange = (e) => contentPage(el, Number(e.target.value), platform);
  $('#plat').onchange = (e) => contentPage(el, days, e.target.value);
}

// A sale is a new patron or a manually added sale. Plan changes, cancellations and other Patreon events are not.
const isNewSale = (s) => s.amount_cents > 0 && (s.event === 'members:pledge:create' || !String(s.event).startsWith('members:'));

// ---------- CSV import of Patreon shop sales (Patreon has no shop API) ----------
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split('\n', 1)[0];
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some((x) => x.trim() !== '')) rows.push(row); }
  return rows;
}

function parseAmount(v) {
  let s = String(v ?? '').trim();
  if (!s) return NaN;
  const neg = /^\(.*\)$|^-/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');   // "12,50" is a decimal comma, "1,250" is thousands
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) * (neg ? -1 : 1) : NaN;
}

const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?/;
/** 01/10/2026 can be 1 October or 10 January: the file decides (a day above 12 gives it away), otherwise day first. */
function detectDayFirst(values) {
  let first = false, second = false;
  for (const v of values) { const m = String(v ?? '').trim().match(DMY); if (!m) continue; if (Number(m[1]) > 12) first = true; if (Number(m[2]) > 12) second = true; }
  return second && !first ? false : true;
}
function parseDateCell(v, dayFirst = true) {
  const s = String(v ?? '').trim();
  const m = s.match(DMY);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const d = dayFirst ? a : b, mo = dayFirst ? b : a;
    return new Date(Number(m[3]), mo - 1, d, Number(m[4] ?? 0), Number(m[5] ?? 0)).getTime();
  }
  let t = Date.parse(s);
  if (Number.isNaN(t)) t = Date.parse(s.replace(' ', 'T'));
  return t;
}

/** Best guess which column is which, from the header names. The user can change every choice before importing. */
function guessColumns(h) {
  const find = (...res) => { for (const re of res) { const i = h.findIndex((x) => re.test(x)); if (i >= 0) return i; } return -1; };
  return {
    product: find(/product|item|listing|title/i, /name/i),
    date: find(/purchase.*(date|time)|(date|time).*purchase|created|paid.*at|date|time|datum/i),
    amount: find(/^total|total|totaal/i, /amount|bedrag/i, /price|prijs/i, /paid|betaald/i, /gross/i),
    status: find(/status|state|refund|terugbetal/i),
    id: find(/order.*id|purchase.*id|transaction|reference|^id$|order/i),
    customer: find(/e-?mail/i, /customer|patron|buyer|user/i),
  };
}

function importCard(last) {
  return `<div class="card strong" id="imp-card"><div class="spread"><h2>Import Patreon shop sales</h2>
      <span class="small muted">${last ? `last import ${ago(last.ts)}${last.latest ? ` · newest sale in it: ${new Date(last.latest).toLocaleDateString('en-GB')}` : ''}` : 'not imported yet'}</span></div>
    <p class="small" style="margin:0 0 8px">Patreon does not offer a shop API, so sales come in through its own export. Once a week (or whenever you like):
      <strong>patreon.com → Audience → Sales → Download CSV</strong>, then choose that file here. Uploading the same sales twice is safe, nothing is counted double.
      E-mail addresses are never stored, only a short anonymous code.</p>
    <input type="file" id="imp-file" accept=".csv,text/csv,.txt">
    <div id="imp-body" style="margin-top:12px"></div></div>`;
}

function bindImport(reload) {
  const body = $('#imp-body');
  $('#imp-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const table = parseCsv(await file.text());
    if (table.length < 2) { body.innerHTML = '<div class="empty">That file has no rows.</div>'; return; }
    const headers = table[0].map((x) => x.trim());
    const data = table.slice(1);
    const cols = guessColumns(headers);
    const opt = (sel) => `<option value="-1">(none)</option>${headers.map((x, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(x)}</option>`).join('')}`;

    const build = () => {
      const g = (r, i) => (i >= 0 ? r[i] ?? '' : '');
      const out = []; let bad = 0;
      const dayFirst = detectDayFirst(data.map((r) => g(r, cols.date)));
      for (const r of data) {
        const amount = parseAmount(g(r, cols.amount)), ts = parseDateCell(g(r, cols.date), dayFirst), product = g(r, cols.product).trim();
        if (!product || Number.isNaN(amount) || Number.isNaN(ts)) { bad++; continue; }
        const status = g(r, cols.status);
        out.push({ id: g(r, cols.id).trim() || undefined, ts, product, amount_cents: Math.abs(amount), customer: g(r, cols.customer).trim() || undefined,
          refunded: amount < 0 || /refund|chargeback|cancel|void|fail|terugbetaald|geannuleerd/i.test(status), status });
      }
      return { out, bad };
    };

    const render = () => {
      const { out, bad } = build();
      const ok = out.filter((r) => !r.refunded);
      const total = ok.reduce((n, r) => n + r.amount_cents, 0);
      const dates = out.map((r) => r.ts);
      body.innerHTML = `
        <div class="grid g3" style="margin-bottom:10px">
          ${[['product', 'Product'], ['date', 'Date'], ['amount', 'Amount'], ['status', 'Status (refunds)'], ['id', 'Order id (avoids doubles)'], ['customer', 'E-mail / buyer']]
            .map(([k, l]) => `<label>${l}<select data-col="${k}">${opt(cols[k])}</select></label>`).join('')}
        </div>
        <div class="${out.length ? '' : 'inbox'}" style="margin-bottom:8px">${out.length
          ? `<strong>${ok.length}</strong> sales · <strong>${money(total)}</strong>${out.length > ok.length ? ` · ${out.length - ok.length} refunded or cancelled (not counted)` : ''}
             · ${new Date(Math.min(...dates)).toLocaleDateString('en-GB')} to ${new Date(Math.max(...dates)).toLocaleDateString('en-GB')}${bad ? ` · <span class="muted">${bad} rows skipped (no product, date or amount)</span>` : ''}`
          : 'Nothing readable yet. Pick which column holds the product, the date and the amount.'}</div>
        ${out.length ? `<div class="table-wrap"><table><tr><th>Date</th><th>Product</th><th class="num">Amount</th><th>Status</th></tr>${out.slice(0, 5).map((r) =>
          `<tr><td class="small">${when(r.ts)}</td><td>${esc(r.product)}</td><td class="num">${money(r.amount_cents)}</td><td class="small muted">${esc(r.refunded ? 'refunded' : r.status || 'ok')}</td></tr>`).join('')}</table></div>
          <div class="small muted" style="margin:4px 0 8px">First 5 of ${out.length} rows. Check that dates and amounts look right before importing.</div>` : ''}
        <button class="primary" id="imp-go" ${out.length ? '' : 'disabled'}>Import ${out.length} rows</button>`;
      body.querySelectorAll('[data-col]').forEach((sel) => sel.onchange = () => { cols[sel.dataset.col] = Number(sel.value); render(); });
      $('#imp-go').onclick = async () => {
        $('#imp-go').disabled = true; $('#imp-go').textContent = 'Importing…';
        let added = 0, skipped = 0;
        try {
          for (let i = 0; i < out.length; i += 2000) {
            const r = await api('/api/sales/import', { json: { rows: out.slice(i, i + 2000) } });
            added += r.added; skipped += r.skipped;
          }
          toast(`${added} sales added${skipped ? `, ${skipped} were already there` : ''}`);
          reload();
        } catch (err) { toast(err.message); render(); }
      };
    };
    render();
  };
}

async function salesPage(el) {
  const d = await api('/api/sales');
  const rows = d.topProducts;
  const max = Math.max(1, ...rows.map((v) => v.cents));
  el.innerHTML = `
    <div class="kpis">
      ${kpi('Sales (60 days)', String(d.totals.n), 'shop products and new patrons')}
      ${kpi('Revenue from sales (60 days)', money(d.totals.cents), '')}
      ${kpi('Monthly membership revenue', money(d.metrics.monthly_revenue_cents?.value), d.metrics.monthly_revenue_cents ? `${d.metrics.patrons?.value ?? 0} patrons` : 'Patreon not connected')}
    </div>
    ${importCard(d.lastImport)}
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2 style="margin-bottom:8px">Best sellers · 60 days</h2>
        ${rows.length ? rows.map((v) => `<div class="bar-row"><span>${esc(v.product)}</span>${bar(v.cents, max, `${v.n} sales · ${money(v.cents)}`)}<span class="num">${money(v.cents)}</span></div>`).join('') : empty('No sales yet. Import your Patreon sales above.')}
      </div>
      <div class="card"><h2 style="margin-bottom:8px">Membership tiers (current)</h2>${productTable(d.products)}</div>
    </div>
    <div class="card" style="margin-top:16px"><h2 style="margin-bottom:8px">Latest sales</h2><div class="table-wrap"><table>
      <tr><th>When</th><th>Product</th><th>Event</th><th class="num">Amount</th></tr>
      ${d.sales.slice(0, 100).map((s) => `<tr><td class="small">${when(s.ts)}</td><td>${esc(s.product)}</td><td class="small muted">${esc(s.event)}</td><td class="num">${money(s.amount_cents)}</td></tr>`).join('') || `<tr><td colspan="4">${empty('Nothing yet.')}</td></tr>`}
    </table></div></div>`;
  bindImport(() => salesPage(el));
}

async function communityPage(el, kind = '') {
  const d = await api(`/api/signals?days=7&kind=${kind}`);
  el.innerHTML = `
    <div class="grid g3">
      <div class="card"><h2 style="margin-bottom:8px">Most mentioned words · 7 days</h2>${keywordBars(d.keywords.slice(0, 25))}</div>
      <div class="card span2">
        <div class="spread"><h2>Messages from Discord tools</h2>
          <select id="kind" style="width:auto">${['', 'request', 'question', 'feedback', 'message'].map((k) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${k || 'All kinds'}</option>`).join('')}</select></div>
        <ul class="list">${d.signals.map((s) => `<li><div class="spread small muted"><span><span class="tag">${esc(s.kind)}</span>${esc(s.author ?? '')} in #${esc(s.channel ?? '?')}</span><span>${ago(s.ts)}</span></div>
          <div>${esc(s.text)}</div></li>`).join('') || `<li>${empty('Nothing yet.')}</li>`}</ul>
      </div>
    </div>`;
  $('#kind').onchange = (e) => communityPage(el, e.target.value);
}

async function discordPage(el) {
  const d = await api('/api/discord');
  if (!d) {
    el.innerHTML = `<div class="card">Discord-Bot-Buddy is not connected yet. <a href="#setup">Connect it on the Setup page →</a></div>`;
    return;
  }
  const st = d.status ?? {};
  const bots = Object.entries(st.bots ?? {});
  el.innerHTML = `
    <div class="spread" style="margin-bottom:12px"><span class="small muted">From Bot Buddy · updated ${ago(d.ts)}</span><button id="buddy-refresh">Refresh</button></div>
    <div class="kpis">
      ${kpi('Questions waiting', String(d.unresolved.length), 'the bots need your answer')}
      ${kpi('Open tickets', String(d.tickets.length), '')}
      ${kpi('Spam removed today', fmt(st.moderationActionsToday), '')}
      ${kpi('Bot AI today', '$' + (st.ai?.estimatedCostToday ?? 0).toFixed(2), `${fmt(st.ai?.callsToday)} calls`)}
      ${bots.map(([k, b]) => kpi(d.personas?.find((p) => p.id === (k === 'founderA' ? 'FOUNDER_A' : 'FOUNDER_B'))?.displayName ?? k, statusBadge(b.connected ? 'online' : 'offline', undefined, 'lg'), b.connected ? `${b.latencyMs} ms` : 'disconnected')).join('')}
    </div>
    <div class="grid g2">
      <div class="card"><h2 style="margin-bottom:8px">Questions the bots couldn't answer</h2>
        ${d.unresolved.length ? d.unresolved.map(questionItem).join('') : empty('✓ None. The bots handled everything.')}</div>
      <div class="stack">
        <div class="card"><h2 style="margin-bottom:8px">Knowledge waiting for approval</h2>
          ${d.proposals.length ? d.proposals.map((p) => `<div class="inbox-item" data-proposal="${esc(p.id)}"><div><strong>${esc(p.question)}</strong></div><div class="quote">${esc(p.answer)}</div>
            <div class="row"><button class="primary" data-act="approve">Approve</button><button data-act="reject">Reject</button></div></div>`).join('') : empty('Nothing to approve.')}</div>
        <div class="card"><h2 style="margin-bottom:8px">Open tickets</h2>
          ${d.tickets.length ? `<ul class="list">${d.tickets.map((t) => `<li class="spread" data-ticket="${esc(t.id)}"><div><strong>#${t.ticketNumber} ${esc(t.category)}</strong> <span class="tag">${esc(String(t.status).toLowerCase().replace(/_/g, ' '))}</span>
            <div class="small muted">${esc(t.summary ?? '')} · opened ${ago(new Date(t.createdAt).getTime())}</div></div><button data-act="close">Close</button></li>`).join('')}</ul>` : empty('No open tickets.')}</div>
      </div>
    </div>`;
  $('#buddy-refresh').onclick = async () => { try { await api('/api/discord/refresh', { json: {} }); discordPage(el); } catch (err) { toast(err.message); } };
  bindInbox(() => discordPage(el));
}

async function trends() {
  view.innerHTML = '<div id="sub"></div>';
  await trendsPage($('#sub'));
}

async function trendsPage(el) {
  const d = await api('/api/trends');
  const top = d.top?.data;
  const report = d.report?.data;
  el.innerHTML = `
    <div class="spread" style="margin-bottom:12px"><span class="small muted">From the UEFN Trends engine${d.top ? ` · updated ${ago(d.top.ts)}` : ' · not connected yet (<a href="#setup">Setup</a>)'}.</span>
      <form class="row" id="watch-form">
        <select name="kind" style="width:auto">${['topic', 'meme', 'fortnite', 'roblox', 'steam', 'reddit'].map((k) => `<option>${k}</option>`).join('')}</select>
        <input name="value" placeholder="Track something, e.g. pets or 1234-5678-9012" style="width:260px" required>
        <button>Track</button>
        <button type="button" id="run-trends">Fresh trend report</button>
      </form></div>
    <div class="grid g2">
      <div class="card"><h2 style="margin-bottom:8px">Top trends</h2>${trendTable(top?.topTrends)}</div>
      <div class="card"><h2 style="margin-bottom:8px">Breakouts</h2>
        ${(top?.breakouts ?? []).length ? `<ul class="list">${top.breakouts.map((b) => `<li class="spread"><span><strong>${esc(b.name ?? b.title ?? b.slug)}</strong> <span class="small muted">${esc(b.platform ?? b.source ?? '')}</span></span><span class="num">${b.score ?? b.breakoutScore ?? ''}</span></li>`).join('')}</ul>` : empty('No breakouts.')}
        <h2 style="margin:16px 0 8px">Memes</h2>
        ${(top?.memes ?? []).length ? `<ul class="list">${top.memes.map((b) => `<li class="spread"><span>${esc(b.name ?? b.title ?? b.slug)} <span class="small muted">${esc(b.source ?? '')}</span></span><span class="num">${b.momentum ?? b.score ?? ''}</span></li>`).join('')}</ul>` : empty('No memes.')}
      </div>
    </div>
    ${report ? `<div class="card" style="margin-top:16px"><h2 style="margin-bottom:8px">Latest trend report${report.generatedAt ? ` · ${when(new Date(report.generatedAt).getTime())}` : ''}</h2><div class="log">${esc(typeof report === 'string' ? report : report.discordText ?? report.text ?? JSON.stringify(report, null, 2))}</div></div>` : ''}`;
  $('#watch-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api('/api/trends/watch', { json: f }); toast(`Now tracking "${f.value}"`); e.target.reset(); } catch (err) { toast(err.message); }
  };
  $('#run-trends').onclick = async () => {
    try { await api('/api/trends/run-report', { json: {} }); toast('UEFN Trends is making a new report. Refresh in a few minutes.'); } catch (err) { toast(err.message); }
  };
}

async function growthPage(el) {
  const series = [['youtube', 'subscribers'], ['tiktok', 'followers'], ['instagram', 'followers'], ['twitter', 'followers'], ['patreon', 'patrons'], ['patreon', 'monthly_revenue_cents'], ['discord', 'members']];
  const data = await Promise.all(series.map(([p, k]) => api(`/api/metrics/history?platform=${p}&key=${k}&days=30`)));
  el.innerHTML = `<p class="small muted">Last 30 days. One small chart per number so each has its own scale.</p>
    <div class="grid g3">${series.map(([p, k], i) => sparkCard(`${pname(p)} · ${k.replace(/_cents$/, '').replace(/_/g, ' ')}`, data[i], k.endsWith('_cents'))).join('')}</div>`;
}

function sparkCard(title, points, isMoney) {
  const f = (v) => (isMoney ? money(v) : fmt(v));
  if (points.length < 2) return `<div class="card"><h3>${esc(title)}</h3>${empty('Not enough data yet.')}</div>`;
  const W = 300, H = 70, pad = 4;
  const xs = points.map((p) => p.ts), ys = points.map((p) => p.value);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (W - pad * 2);
  const sy = (y) => H - pad - ((y - y0) / (y1 - y0 || 1)) * (H - pad * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.ts).toFixed(1)},${sy(p.value).toFixed(1)}`).join('');
  const last = points.at(-1), first = points[0];
  // Invisible wide hit areas per point carry the tooltip.
  const hits = points.map((p, i) => {
    const prev = i ? sx(points[i - 1].ts) : sx(p.ts);
    const next = i < points.length - 1 ? sx(points[i + 1].ts) : sx(p.ts);
    return `<rect x="${(prev + sx(p.ts)) / 2}" y="0" width="${Math.max(2, (next - prev) / 2)}" height="${H}" fill="transparent" data-tip="${esc(new Date(p.ts).toLocaleDateString('en-GB'))}: ${esc(f(p.value))}"/>`;
  }).join('');
  return `<div class="card"><div class="spread"><h3>${esc(title)}</h3><strong class="num">${f(last.value)}</strong></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)} trend">
      <path d="${path}" fill="none" stroke="var(--fg)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>${hits}</svg>
    <div class="small muted">${signed(isMoney ? (last.value - first.value) / 100 : last.value - first.value)}${isMoney ? ' $' : ''} in 30 days</div></div>`;
}

// ======================================================================
// AI
// ======================================================================
async function ai(sub) {
  const reports = await api('/api/reports');
  if (pageName() !== 'ai') return;
  const id = sub ? Number(sub) : reports.find((r) => r.status === 'done')?.id;
  const r = id ? await api(`/api/reports/${id}`) : null;
  const running = reports.find((x) => x.status === 'running' || x.status === 'queued');
  const j = r?.json;
  const list = (title, items) => `<div class="card"><h2 style="margin-bottom:6px">${title}</h2>${items?.length ? `<ul class="bullets">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : empty('-')}</div>`;

  view.innerHTML = `
    <div class="spread" style="margin-bottom:16px">
      <div><h1 style="font-size:20px">Daily AI analysis</h1>
      <div class="small muted">Every morning the AI reads all incoming data, combines it with the UEFN trends and searches the web for what people want.</div></div>
      ${running?.status === 'queued' ? `<div class="small muted" style="flex-basis:100%">Waiting for your build PC. The analysis runs there (on your Claude subscription) and starts as soon as the PC is on and the start file is running. See <a href="#build">Build queue</a>.</div>` : ''}
      <button class="primary" id="run" ${running ? 'disabled' : ''}>${running ? (running.status === 'queued' ? 'Waiting for the build PC…' : 'Running… (takes a few minutes)') : 'Run analysis now'}</button>
    </div>
    <div class="grid g3">
      <div class="span2 stack">
        ${j ? `
          <div class="card strong"><div class="small muted">${when(r.ts)} · cost ≈ $${(r.cost_usd ?? 0).toFixed(2)}</div>
            <div class="headline" style="margin-top:4px">${esc(j.headline)}</div><p>${esc(j.summary)}</p></div>
          <div class="grid g2">${list('Focus today', j.todayFocus)}${list('People want', j.audienceWants)}${list('Working', j.working)}${list('Not working', j.notWorking)}</div>
          ${list('Market signals (from the web)', j.marketSignals)}
          <h2 class="section-title">Ideas from this report</h2>
          <div class="grid g2">${r.ideas.map(ideaCard).join('') || empty('No ideas.')}</div>
        ` : r?.status === 'failed' ? `<div class="card strong">This run failed: ${esc(r.error)}</div>` : empty('No report yet. Press "Run analysis now".')}
      </div>
      <div class="card"><h2 style="margin-bottom:8px">History</h2>
        <ul class="list">${reports.map((x) => `<li><a href="#ai/${x.id}" style="text-decoration:${x.id === id ? 'underline' : 'none'}">
          <div class="small muted">${when(x.ts)} · ${esc(x.status)}</div><div>${esc(x.summary ?? x.error ?? '')}</div></a></li>`).join('') || '<li class="muted">None</li>'}</ul></div>
    </div>`;
  bindIdeaButtons();
  $('#run').onclick = async () => {
    try {
      const r = await api('/api/reports/run', { json: {} });
      toast(r.mode === 'machine' ? 'Sent to the build PC (first in the queue). You get a Discord ping when it is ready.' : 'Analysis started on the server. It takes a minute or two, and you get a Discord ping when it is ready.');
      setTimeout(route, 1000);
    }
    catch (err) { toast(err.message); }
  };
  if (running) timer = setInterval(() => keepScroll(() => ai(sub)).catch(() => {}), 15_000);
}

// ======================================================================
// KNOWLEDGE (what the Discord bots know)
// ======================================================================
const K_STOP = new Set(('de het een en of van in op voor met is zijn was wat hoe waar wanneer wie waarom kan ik je jij we wij ons dit dat die dan om te er '
  + 'naar bij als maar ook niet geen wel nog dus mijn jullie moet kunnen heb hebben wil wilt the a an and or to of in on for is it you we can be with this that '
  + 'how do does my me your are was what when where why there their they have has just so but not no yes please would could should will get make like want need '
  + 'any some from at as by if about its').split(' '));

/** Simple starting point for keywords: the meaningful words of the question. */
function suggestKeywords(question) {
  const seen = new Set();
  return question.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !K_STOP.has(w) && !seen.has(w) && seen.add(w)).slice(0, 6);
}

/**
 * Turns pasted blocks into entries. Per entry (blank line between entries):
 *   V: question                       (Q: works too)
 *   O: other phrasing | another one   (optional, "other ways to ask", separated by |)
 *   C: category                       (optional)
 *   K: keyword, keyword               (optional, made automatically when left out)
 *   A: answer                         (last; may span several lines)
 */
function parseBulk(text) {
  const items = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n(?=\s*(?:V|Q)\s*:)/i)) {
    const it = { question: '', answer: '', aliases: [], keywords: [], category: '' };
    let field = null;
    for (const line of block.split('\n')) {
      const m = field === 'A' ? null : line.match(/^\s*(V|Q|O|C|K|A)\s*:\s?(.*)$/i);
      if (m) {
        field = m[1].toUpperCase() === 'Q' ? 'V' : m[1].toUpperCase();
        const v = m[2].trim();
        if (field === 'V') it.question = v;
        else if (field === 'O') it.aliases.push(...v.split('|').map((x) => x.trim()).filter(Boolean));
        else if (field === 'C') it.category = v;
        else if (field === 'K') it.keywords.push(...v.split(',').map((x) => x.trim()).filter(Boolean));
        else it.answer = v;
      } else if (field === 'A') it.answer += `\n${line}`;
      else if (field === 'V' && line.trim()) it.question += ` ${line.trim()}`;
    }
    it.answer = it.answer.trim();
    if (it.question.trim().length < 3 || !it.answer) continue;
    if (!it.keywords.length) it.keywords = suggestKeywords(it.question);
    if (!it.category) delete it.category;
    items.push(it);
  }
  return items;
}

function knowledgeForm(item = {}, categories = []) {
  const id = item.id ? `data-edit="${esc(item.id)}"` : 'id="k-new"';
  return `<form class="stack" ${id}>
    <label>Vraag (zoals iemand ze zou stellen)<input name="question" required minlength="3" maxlength="500" value="${esc(item.question ?? '')}" placeholder="Wat kost het pet system?"></label>
    <label>Antwoord (precies zoals de bot het stuurt)<textarea name="answer" required maxlength="1900" rows="4" placeholder="Het pet system zit in de Creator tier ($10/maand) op Patreon…">${esc(item.answer ?? '')}</textarea></label>
    <label>Zo kan het ook gevraagd worden (één per regel, optioneel maar sterk aangeraden)
      <textarea name="aliases" rows="3" placeholder="prijs pet system&#10;hoeveel kost het pet system&#10;is het pet system gratis">${esc((item.aliases ?? []).join('\n'))}</textarea></label>
    <div class="grid g2">
      <label>Trefwoorden (komma's)<input name="keywords" value="${esc((item.keywords ?? []).join(', '))}" placeholder="pet, prijs, kost"></label>
      <label>Categorie<input name="category" list="k-cats" value="${esc(item.category ?? 'general')}"><datalist id="k-cats">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
    </div>
    <label class="check"><input type="checkbox" name="directAnswer" ${item.directAnswer === false ? '' : 'checked'}> Stuur het antwoord letterlijk als de vraag er sterk op lijkt (sneller, kost niets)</label>
    <div class="row"><button class="primary" type="submit">${item.id ? 'Opslaan' : 'Toevoegen'}</button>${item.id ? '<button type="button" data-cancel>Annuleren</button>' : ''}<span class="small muted" data-msg></span></div>
  </form>`;
}

const kPayload = (form) => {
  const f = Object.fromEntries(new FormData(form));
  const list = (v, sep) => String(v ?? '').split(sep).map((x) => x.trim()).filter(Boolean);
  return {
    question: f.question.trim(), answer: f.answer.trim(), category: (f.category || 'general').trim(),
    aliases: list(f.aliases, '\n'), keywords: list(f.keywords, ','), directAnswer: form.elements.directAnswer.checked,
  };
};

async function knowledge() {
  const d = await api('/api/knowledge/overview').catch((err) => ({ error: err.message }));
  const drafts = d.error ? [] : await api('/api/knowledge/drafts').catch(() => []);
  if (d.error) {
    view.innerHTML = `<div class="card strong">Bot Buddy is niet bereikbaar (${esc(d.error)}). <a href="#setup">Controleer de verbinding op de Setup-pagina →</a></div>`;
    return;
  }
  let state = { q: '', category: '', enabled: '', offset: 0 };
  view.innerHTML = `
    <div class="spread" style="margin-bottom:16px"><div><h1 style="font-size:20px">Kennisbank van de Discord-bots</h1>
      <div class="small muted">De bots antwoorden over jullie bedrijf alleen op wat hier staat. Hoe meer ze weten, hoe minder "ik vraag het na" je ziet.</div></div></div>
    <div class="kpis">
      ${kpi('Actieve antwoorden', String(d.active), 'de bots gebruiken deze')}
      ${kpi('Uitgeschakeld', String(d.total - d.active), 'worden niet gebruikt')}
      ${kpi('Onbeantwoorde vragen', String(d.gaps.length), 'wachten op jou')}
    </div>
    ${drafts.length ? `<div class="inbox" id="k-drafts" style="margin-bottom:16px">
      <div class="spread"><h2>Te controleren · ${drafts.length} nieuw${drafts.length > 1 ? 'e' : ''} antwoord${drafts.length > 1 ? 'en' : ''}</h2>
        <span class="row"><button class="primary" id="k-approve-all">Alles goedkeuren</button><button id="k-clear">Alles weggooien</button></span></div>
      <p class="small muted" style="margin:4px 0 0">Binnengekomen via een tool (bv. Codex). De bots gebruiken ze pas nadat je ze goedkeurt. Controleer vooral prijzen en links.</p>
      ${drafts.map((r) => `<div class="inbox-item spread" data-draft="${r.id}"><div style="min-width:0;flex:1"><strong>${esc(r.question)}</strong>
        <div class="small" style="white-space:pre-wrap">${esc(r.answer)}</div>
        <div class="small muted">${r.category ? `<span class="tag">${esc(r.category)}</span>` : ''}${r.aliases.length ? esc(r.aliases.join(' · ')) : 'geen alternatieve formuleringen'}</div></div>
        <div class="row"><button data-act="ok" class="primary">Goedkeuren</button><button data-act="no">Weg</button></div></div>`).join('')}
    </div>` : ''}
    ${d.active === 0 && !drafts.length ? `<div class="inbox" style="margin-bottom:16px"><strong>De kennisbank is leeg.</strong> Daarom zegt de bot overal "ik vraag het na". Voeg hieronder je 10 meest gestelde vragen toe, of plak ze in één keer bij "Meerdere tegelijk".</div>` : ''}
    <div class="grid g2">
      <div class="stack">
        <div class="card strong"><h2 style="margin-bottom:10px">Antwoord toevoegen</h2><div id="k-add">${knowledgeForm({}, d.categories)}</div></div>
        <div class="card"><h2 style="margin-bottom:6px">Meerdere tegelijk toevoegen</h2>
          <p class="small muted" style="margin-top:0">Per antwoord: <span class="mono">V:</span> vraag, optioneel <span class="mono">O:</span> andere manieren om te vragen (gescheiden door |) en <span class="mono">C:</span> categorie, en als laatste <span class="mono">A:</span> antwoord. Lege regel tussen de antwoorden. Trefwoorden worden automatisch gemaakt.</p>
          <textarea id="k-bulk" rows="8" placeholder="V: Wat kost het pet system?&#10;O: prijs pet system | hoeveel kost het pet system&#10;C: patreon&#10;A: Het zit in de Creator tier ($10/maand) op Patreon.&#10;&#10;V: Hoe installeer ik een systeem?&#10;A: Sleep het device in je level, koppel de widget en push changes."></textarea>
          <div class="row" style="margin-top:8px"><button id="k-bulk-go" class="primary">Toevoegen</button><span id="k-bulk-info" class="small muted"></span></div>
        </div>
      </div>
      <div class="stack">
        <div class="card"><h2 style="margin-bottom:6px">Test: wat zou de bot antwoorden?</h2>
          <form id="k-test" class="row"><input name="query" placeholder="Typ een vraag zoals een lid ze zou stellen" required style="flex:1"><button>Test</button></form>
          <div id="k-test-out" class="small" style="margin-top:10px"></div></div>
        <div class="card"><h2 style="margin-bottom:6px">Vragen waar de bot geen antwoord op had</h2>
          ${d.gaps.length ? `<ul class="list">${d.gaps.map((g) => `<li class="spread"><div><strong>${esc(g.question)}</strong><div class="small muted">${esc(g.username)} · ${ago(new Date(g.createdAt).getTime())}</div></div>
            <button data-gap="${esc(g.question)}">Antwoord toevoegen</button></li>`).join('')}</ul>` : empty('✓ Niets openstaand.')}
          ${d.topWords.length ? `<h3 style="margin:14px 0 6px">Waar leden het vaakst naar vragen · 14 dagen</h3>${keywordBars(d.topWords)}` : ''}
        </div>
      </div>
    </div>
    <h2 class="section-title">Alle antwoorden</h2>
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <input id="k-q" placeholder="Zoek in vragen en antwoorden" style="flex:1;min-width:200px">
        <select id="k-cat" style="width:auto"><option value="">Alle categorieën</option>${d.categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
        <select id="k-en" style="width:auto"><option value="">Alle</option><option value="true">Actief</option><option value="false">Uitgeschakeld</option></select>
        <button id="k-ex" hidden>Voorbeelden verwijderen</button>
      </div>
      <div id="k-list"></div>
    </div>`;

  const reload = () => knowledge();
  const flash = (el, msg) => { const m = el.querySelector('[data-msg]'); if (m) m.textContent = msg; };

  // drafts
  const approve = async (ids) => {
    try {
      const r = await api('/api/knowledge/drafts/approve', { json: { ids } });
      toast(`${r.added} goedgekeurd. De bots gebruiken ze meteen.`);
      if (r.errors.length) alert(r.errors.join('\n'));
      reload();
    } catch (err) { toast(err.message); }
  };
  $('#k-approve-all')?.addEventListener('click', () => approve());
  $('#k-clear')?.addEventListener('click', async () => { if (confirm('Alle concepten weggooien?')) { await api('/api/knowledge/drafts/clear', { json: {} }); reload(); } });
  view.querySelectorAll('[data-draft] [data-act]').forEach((b) => b.onclick = async () => {
    const id = Number(b.closest('[data-draft]').dataset.draft);
    if (b.dataset.act === 'ok') return approve([id]);
    await api(`/api/knowledge/drafts/${id}`, { method: 'DELETE' }); reload();
  });

  // add one
  const addForm = $('#k-new');
  const qInput = addForm.elements.question;
  qInput.addEventListener('blur', () => { if (!addForm.elements.keywords.value.trim() && qInput.value.trim()) addForm.elements.keywords.value = suggestKeywords(qInput.value).join(', '); });
  addForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const body = kPayload(addForm);
      if (!body.keywords.length) body.keywords = suggestKeywords(body.question);
      await api('/api/knowledge', { json: body });
      toast('Toegevoegd. De bots gebruiken het meteen.');
      reload();
    } catch (err) { flash(addForm, err.message); }
  };
  view.querySelectorAll('[data-gap]').forEach((b) => b.onclick = () => {
    qInput.value = b.dataset.gap;
    addForm.elements.keywords.value = suggestKeywords(b.dataset.gap).join(', ');
    addForm.elements.answer.focus();
    addForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // bulk
  const bulk = $('#k-bulk');
  bulk.oninput = () => { const n = parseBulk(bulk.value).length; $('#k-bulk-info').textContent = n ? `${n} antwoord${n > 1 ? 'en' : ''} herkend` : ''; };
  $('#k-bulk-go').onclick = async () => {
    const items = parseBulk(bulk.value);
    if (!items.length) return toast('Geen vragen herkend. Gebruik "V:" en "A:".');
    try {
      const r = await api('/api/knowledge/bulk', { json: { items } });
      toast(`${r.added} toegevoegd${r.errors.length ? `, ${r.errors.length} mislukt` : ''}`);
      if (r.errors.length) alert(r.errors.join('\n'));
      reload();
    } catch (err) { toast(err.message); }
  };

  // test
  $('#k-test').onsubmit = async (e) => {
    e.preventDefault();
    const out = $('#k-test-out');
    out.textContent = 'Zoeken…';
    try {
      const matches = await api('/api/knowledge/search', { json: { query: new FormData(e.target).get('query') } });
      const top = matches[0];
      const verdict = !top || top.score < 0.3 ? [`${dot('offline')}Niets gevonden`, 'De bot zegt "ik vraag het na" en zet de vraag bij Needs you. Voeg dit antwoord toe.']
        : top.directAnswerEligible ? [`${dot('online')}Antwoordt meteen`, 'De bot stuurt dit antwoord letterlijk, zonder AI.']
          : top.score >= 0.45 ? [`${dot('online')}Antwoordt met AI`, 'De AI formuleert een antwoord op basis van dit item.']
            : [`${dot('degraded')}Te zwak`, 'De bot durft hier niet op te antwoorden. Voeg "zo kan het ook gevraagd worden" of trefwoorden toe.'];
      out.innerHTML = `<div class="quote"><strong>${verdict[0]}</strong><div>${verdict[1]}</div></div>` + matches.slice(0, 4).map((m) =>
        `<div style="margin-top:6px"><span class="tag ${m.score >= 0.45 ? 'dark' : ''}">${Math.round(m.score * 100)}%</span><span class="tag">${esc(m.matchedBy)}</span> <strong>${esc(m.item.question)}</strong></div>`).join('');
    } catch (err) { out.textContent = err.message; }
  };

  // list
  async function loadList(append = false) {
    const el = $('#k-list');
    const params = new URLSearchParams({ offset: state.offset });
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    if (state.enabled) params.set('enabled', state.enabled);
    const r = await api(`/api/knowledge?${params}`);
    const rows = r.items.map((i) => `<div class="inbox-item" data-k="${esc(i.id)}" data-json='${esc(JSON.stringify(i))}'>
      <div class="spread"><div style="min-width:0;flex:1"><strong>${esc(i.question)}</strong>
        <div class="small muted" style="white-space:pre-wrap">${esc(i.answer.length > 240 ? i.answer.slice(0, 240) + '…' : i.answer)}</div>
        <div style="margin-top:4px"><span class="tag">${esc(i.category)}</span>${i.source === 'EXAMPLE' ? '<span class="tag">voorbeeld</span>' : ''}${i.enabled ? '' : '<span class="tag dark">uit</span>'}
          ${i.directAnswer ? '<span class="tag">letterlijk</span>' : '<span class="tag">via AI</span>'}${(i.aliases ?? []).length ? `<span class="small muted">${i.aliases.length} formulering${i.aliases.length > 1 ? 'en' : ''}</span>` : '<span class="small muted">geen alternatieve formuleringen</span>'}</div></div>
        <div class="row"><button data-act="toggle">${i.enabled ? 'Uitzetten' : 'Aanzetten'}</button><button data-act="edit">Aanpassen</button><button data-act="delete">Verwijderen</button></div></div>
      <div data-editbox hidden></div></div>`).join('');
    el.innerHTML = (append ? el.innerHTML.replace(/<div class="spread"[^>]*data-more[\s\S]*$/, '') : '') + rows;
    if (!append && !r.items.length) el.innerHTML = empty(state.q || state.category || state.enabled ? 'Niets gevonden.' : 'Nog geen antwoorden. Voeg er hierboven een toe.');
    if (state.offset + r.items.length < r.total) el.insertAdjacentHTML('beforeend', `<div class="spread" data-more><span class="small muted">${state.offset + r.items.length} van ${r.total}</span><button id="k-more">Meer laden</button></div>`);
    $('#k-more')?.addEventListener('click', () => { state.offset += 50; loadList(true); });
    $('#k-ex').hidden = !r.items.some((i) => i.source === 'EXAMPLE') && state.enabled !== 'false';
    bindRows();
  }
  function bindRows() {
    $('#k-list').querySelectorAll('[data-k] [data-act]').forEach((btn) => btn.onclick = async () => {
      const row = btn.closest('[data-k]');
      const item = JSON.parse(row.dataset.json);
      try {
        if (btn.dataset.act === 'toggle') { await api(`/api/knowledge/${item.id}`, { method: 'PATCH', json: { enabled: !item.enabled } }); return reload(); }
        if (btn.dataset.act === 'delete') { if (!confirm('Dit antwoord verwijderen?')) return; await api(`/api/knowledge/${item.id}`, { method: 'DELETE' }); return reload(); }
        const box = row.querySelector('[data-editbox]');
        box.hidden = false; box.innerHTML = `<div style="margin-top:10px">${knowledgeForm(item, d.categories)}</div>`;
        const form = box.querySelector('form');
        form.querySelector('[data-cancel]').onclick = () => { box.hidden = true; box.innerHTML = ''; };
        form.onsubmit = async (ev) => {
          ev.preventDefault();
          try { await api(`/api/knowledge/${item.id}`, { method: 'PATCH', json: kPayload(form) }); toast('Opgeslagen'); reload(); }
          catch (err) { flash(form, err.message); }
        };
      } catch (err) { toast(err.message); }
    });
  }
  let t;
  $('#k-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { state = { ...state, q: e.target.value, offset: 0 }; loadList(); }, 300); };
  $('#k-cat').onchange = (e) => { state = { ...state, category: e.target.value, offset: 0 }; loadList(); };
  $('#k-en').onchange = (e) => { state = { ...state, enabled: e.target.value, offset: 0 }; loadList(); };
  $('#k-ex').onclick = async () => {
    if (!confirm('De 4 voorbeeldantwoorden verwijderen? Ze zijn uitgeschakeld en worden toch niet gebruikt.')) return;
    try { const r = await api('/api/knowledge/remove-examples', { json: {} }); toast(`${r.removed} verwijderd`); reload(); } catch (err) { toast(err.message); }
  };
  loadList();
}

// ======================================================================
// OUTGOING
// ======================================================================
async function outgoing() {
  const [posts, settings] = await Promise.all([api('/api/posts'), api('/api/settings')]);
  const prefill = JSON.parse(sessionStorage.getItem('prefillPost') ?? 'null');
  sessionStorage.removeItem('prefillPost');
  const local = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);

  view.innerHTML = `
    <div class="grid g2">
      <form class="card strong stack" id="post-form">
        <div class="spread"><h2>Upload a video</h2><span class="small muted">Publisher: <strong>${esc(settings.publisher.mode)}</strong>${settings.publisher.mode === 'manual' ? ' (you get a Discord reminder to post)' : ''}</span></div>
        <label>Video file <input type="file" name="file" accept="video/*"></label>
        <label>Title <input name="title" required value="${esc(prefill?.title ?? '')}" placeholder="What is this video?"></label>
        <label>Notes for the AI (optional) <input name="notes" placeholder="e.g. showcase of the pet egg hatch, link to Patreon"></label>
        <div><div class="small muted" style="margin-bottom:4px">Post to</div>
          ${PLATFORMS.map((p) => `<label class="check"><input type="checkbox" name="platforms" value="${p}" checked> ${pname(p)}</label>`).join('')}</div>
        <div class="spread"><label style="flex:1">Caption (used everywhere unless overridden)
          <textarea name="caption" rows="3">${esc(prefill?.caption ?? '')}</textarea></label></div>
        <div class="row"><button type="button" id="ai-captions" ${settings.ai.configured ? '' : 'disabled'}>✎ Write captions per platform with AI</button>
          ${settings.ai.configured ? '' : '<span class="small muted">Needs an OpenAI key (Setup → AI)</span>'}</div>
        <div id="per-platform" class="stack"></div>
        <label>Hashtags (added to the shared caption) <input name="hashtags" placeholder="#uefn #fortnite #fortnitecreative"></label>
        <div class="row">
          <label style="flex:1">When <input type="datetime-local" name="when" value="${local}"></label>
          <label class="check" style="margin-top:18px"><input type="checkbox" name="draft"> Save as draft</label>
        </div>
        <input type="hidden" name="idea_id" value="${esc(prefill?.idea_id ?? '')}">
        <div class="row"><button class="primary" type="submit">Schedule post</button><span id="upload-progress" class="small muted"></span></div>
      </form>

      <div class="card">
        <h2 style="margin-bottom:8px">Posts</h2>
        <ul class="list">${posts.map(postRow).join('') || `<li>${empty('Nothing posted yet.')}</li>`}</ul>
      </div>
    </div>`;

  const form = $('#post-form');
  let captions = {};
  $('#ai-captions').onclick = async (e) => {
    const f = new FormData(form);
    const platforms = f.getAll('platforms');
    if (!f.get('title')) return toast('Add a title first');
    e.target.disabled = true; e.target.textContent = 'Writing…';
    try {
      captions = await api('/api/captions', { json: { title: f.get('title'), notes: f.get('notes'), platforms } });
      $('#per-platform').innerHTML = [...platforms, ...(captions.youtubeTitle ? ['youtubeTitle'] : [])].map((p) =>
        `<label>${p === 'youtubeTitle' ? 'YouTube title' : pname(p)} <textarea data-cap="${p}" rows="${p === 'youtubeTitle' ? 1 : 3}">${esc(captions[p] ?? '')}</textarea></label>`).join('');
    } catch (err) { toast(err.message); }
    e.target.disabled = false; e.target.textContent = '✎ Write captions per platform with AI';
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const per = {};
    form.querySelectorAll('[data-cap]').forEach((t) => { if (t.value.trim()) per[t.dataset.cap] = t.value.trim(); });
    const body = new FormData();
    for (const k of ['title', 'caption', 'hashtags', 'idea_id']) body.append(k, f.get(k) ?? '');
    body.append('platforms', f.getAll('platforms').join(','));
    body.append('captions_json', Object.keys(per).length ? JSON.stringify(per) : '');
    body.append('scheduled_at', String(new Date(f.get('when')).getTime() || Date.now()));
    if (f.get('draft')) body.append('draft', '1');
    const file = f.get('file');
    if (file && file.size) body.append('file', file);
    // XHR so we can show upload progress for big videos.
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/posts');
    xhr.upload.onprogress = (ev) => { $('#upload-progress').textContent = ev.lengthComputable ? `Uploading ${Math.round((ev.loaded / ev.total) * 100)}%` : 'Uploading…'; };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { toast('Post scheduled'); outgoing(); }
      else toast(JSON.parse(xhr.responseText || '{}').error ?? `Upload failed (${xhr.status})`);
    };
    xhr.onerror = () => toast('Upload failed');
    xhr.send(body);
  };

  view.querySelectorAll('[data-post] [data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.closest('[data-post]').dataset.post;
      const act = btn.dataset.act;
      try {
        if (act === 'now') await api(`/api/posts/${id}/publish`, { json: {} });
        else await api(`/api/posts/${id}/status`, { json: { status: act } });
        outgoing();
      } catch (err) { toast(err.message); }
    };
  });
}

function postRow(p) {
  const results = p.results_json ? JSON.parse(p.results_json) : {};
  const caps = p.captions_json ? JSON.parse(p.captions_json) : {};
  return `<li data-post="${p.id}">
    <div class="spread"><strong>${esc(p.title)}</strong><span class="tag ${p.status === 'failed' ? 'dark' : ''}">${esc(p.status)}</span></div>
    <div class="small muted">${when(p.scheduled_at)} (${ago(p.scheduled_at)}) · by ${esc(p.created_by ?? '?')} ${p.file_name ? `· <a href="media/${p.id}" target="_blank">${esc(p.file_name)}</a>` : '· no video attached'}</div>
    <div class="row" style="margin-top:4px">${p.platforms.split(',').map((pl) => {
      const r = results[pl];
      return `<span class="tag ${r?.status === 'failed' ? 'dark' : ''}" data-tip="${esc(r?.error ?? r?.status ?? 'waiting')}">${r?.url ? `<a href="${esc(r.url)}" target="_blank">${pname(pl)} ↗</a>` : pname(pl)} ${r ? (r.status === 'published' ? '✓' : r.status === 'failed' ? '✕' : '…') : ''}</span>`;
    }).join('')}</div>
    <details style="margin-top:4px"><summary>Caption</summary><div class="small" style="white-space:pre-wrap">${esc(p.caption)}${Object.entries(caps).map(([k, v]) => `\n\n<strong>${esc(pname(k))}:</strong> ${esc(v)}`).join('')}</div></details>
    <div class="row" style="margin-top:6px">
      ${['scheduled', 'draft'].includes(p.status) ? `<button data-act="now">Publish now</button>` : ''}
      ${p.status === 'draft' ? `<button data-act="scheduled">Schedule</button>` : ''}
      ${p.status === 'scheduled' ? `<button data-act="cancelled">Cancel</button>` : ''}
      ${['manual', 'failed', 'partial'].includes(p.status) ? `<button data-act="published">Mark as posted</button><button data-act="now">Retry</button>` : ''}
    </div></li>`;
}

// ======================================================================
// BUILD QUEUE
// ======================================================================
async function build(sub) {
  const [jobs, services] = await Promise.all([api('/api/jobs'), api('/api/services')]);
  if (pageName() !== 'build') return;
  const machines = services.filter((s) => s.kind === 'machine');
  const running = jobs.filter((j) => j.status === 'running');
  const queued = jobs.filter((j) => j.status === 'queued');
  const done = jobs.filter((j) => !['running', 'queued'].includes(j.status));
  const openId = Number(sub) || running[0]?.id;
  const open = openId ? await api(`/api/jobs/${openId}`) : null;

  view.innerHTML = `
    <div class="grid g3">
      <div class="stack">
        <form class="card strong stack" id="job-form">
          <h2>New build prompt</h2>
          <label>Title <input name="title" placeholder="e.g. Pet system v1"></label>
          <label>Prompt for Claude on the build machine <textarea name="prompt" rows="8" required placeholder="What should be built in UEFN? Be specific: devices, UI, behaviour, how to test it."></textarea></label>
          <div class="spread"><label class="check"><input type="checkbox" name="top"> Put at the front</label><button class="primary" type="submit">Add to queue</button></div>
        </form>
        <div class="card"><h2 style="margin-bottom:8px">Machines</h2>
          ${machines.map((s) => `<div class="spread"><span><strong>${esc(s.label)}</strong><div class="small muted">${esc(s.detail ?? '')} · ${ago(s.last_seen)}</div></span>${statusBadge(s.status)}</div>`).join('') || empty('No build PC connected yet.')}
          <div style="margin-top:12px"><a class="btn${machines.length ? '' : ' primary'}" href="api/machine-script" style="${machines.length ? '' : 'background:var(--invert-bg);color:var(--invert-fg)'}">⬇ Download start file for the build PC</a>
          <div class="small muted" style="margin-top:6px">Put it in your UEFN project folder on the build PC and double-click it. It installs what's missing, then works through this queue. Log in to Claude once by running <span class="mono">claude</span> in a terminal.</div></div>
        </div>
      </div>

      <div class="span2 stack">
        <div class="card">
          <h2 style="margin-bottom:8px">Queue</h2>
          <ul class="list">
            ${running.map((j) => jobRow(j, true)).join('')}
            ${queued.map((j, i) => jobRow(j, false, i, queued.length)).join('')}
            ${!running.length && !queued.length ? `<li>${empty('Queue is empty. Add a prompt or send an AI idea here.')}</li>` : ''}
          </ul>
        </div>
        ${open ? `<div class="card"><div class="spread"><h2>#${open.id} ${esc(open.title)}</h2><span class="tag ${open.status === 'failed' ? 'dark' : ''}">${esc(open.status)}</span></div>
          <div class="small muted">${open.machine ? `on ${esc(open.machine)} · ` : ''}started ${ago(open.started_at)}${open.finished_at ? ` · finished ${ago(open.finished_at)}` : ''} · attempts ${open.attempts}</div>
          ${open.summary ? `<p><strong>Result:</strong> ${esc(open.summary)}</p>` : ''}
          <details><summary>Prompt</summary><div class="log mono" style="margin-top:6px">${esc(open.prompt)}</div></details>
          <h3 style="margin:10px 0 6px">Live log</h3><div class="log mono" id="joblog">${esc(open.log || 'No output yet.')}</div></div>` : ''}
        <div class="card"><h2 style="margin-bottom:8px">Finished</h2>
          <div class="table-wrap"><table><tr><th>Build</th><th>Status</th><th>Finished</th><th></th></tr>
          ${done.map((j) => `<tr data-job="${j.id}"><td class="title"><a href="#build/${j.id}">${esc(j.title)}</a><div class="small muted">${esc((j.summary ?? '').slice(0, 140))}</div></td>
            <td><span class="tag ${j.status === 'failed' ? 'dark' : ''}">${esc(j.status)}</span></td><td class="small">${ago(j.finished_at)}</td>
            <td><button data-act="retry">Run again</button></td></tr>`).join('') || `<tr><td colspan="4">${empty('Nothing finished yet.')}</td></tr>`}
          </table></div></div>
      </div>
    </div>`;

  $('#job-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api('/api/jobs', { json: { title: f.get('title'), prompt: f.get('prompt'), top: !!f.get('top') } }); toast('Added to the queue'); build(); }
    catch (err) { toast(err.message); }
  };
  view.querySelectorAll('[data-job] [data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.closest('[data-job]').dataset.job;
      const act = btn.dataset.act;
      try {
        if (act === 'up' || act === 'down') await api(`/api/jobs/${id}/move`, { json: { dir: act } });
        if (act === 'cancel' && confirm('Cancel this build?')) await api(`/api/jobs/${id}/cancel`, { json: {} });
        if (act === 'retry') await api(`/api/jobs/${id}/retry`, { json: {} });
        build(sub);
      } catch (err) { toast(err.message); }
    };
  });
  const log = $('#joblog');
  if (log) log.scrollTop = log.scrollHeight;
  if (running.length) timer = setInterval(() => { if (!document.hidden) keepScroll(() => build(sub)).catch(() => {}); }, 8000);
}

function jobRow(j, isRunning, i = 0, n = 0) {
  return `<li data-job="${j.id}" class="spread">
    <div style="min-width:0;flex:1"><div>${isRunning ? '<span class="tag dark">building</span>' : `<span class="muted">${i + 1}.</span>`} <a href="#build/${j.id}"><strong>${esc(j.title)}</strong></a></div>
      <div class="small muted">${j.kind === 'analysis' ? '<span class="tag">daily AI</span>' : ''}${isRunning ? `on ${esc(j.machine)} · ${ago(j.started_at)}` : `added by ${esc(j.created_by ?? '?')} ${ago(j.created_at)}${j.summary ? ` · ${esc(j.summary)}` : ''}`}</div></div>
    <div class="row">${isRunning ? '' : `<button data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button data-act="down" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>`}
      <button data-act="cancel">Cancel</button></div></li>`;
}

// ======================================================================
// STATUS
// ======================================================================
async function status() {
  const svcs = await api('/api/services');
  const groups = { bot: 'Discord bots', machine: 'Build PC', trends: 'UEFN Trends sources', heartbeat: 'Other bots (heartbeats)', http: 'Websites & APIs', connector: 'Connections' };
  const down = svcs.filter((x) => x.status === 'offline').length;
  view.innerHTML = `<div class="spread" style="margin-bottom:12px"><span class="status lg ${down ? 'offline' : 'online'}">${dot(down ? 'offline' : 'online')}${down ? `${down} offline` : 'Everything is online'}</span></div><div id="server-box"></div>` +
    Object.entries(groups).map(([kind, title]) => {
      const rows = svcs.filter((x) => x.kind === kind);
      if (!rows.length) return '';
      return `<div class="card" style="margin-bottom:16px"><h2 style="margin-bottom:8px">${title}</h2>
        <div class="table-wrap"><table><tr><th>Service</th><th>Status</th><th>Detail</th><th>Last seen</th><th>Status since</th></tr>
          ${rows.map((x) => `<tr><td><strong>${esc(x.label ?? x.name)}</strong>${x.url ? `<div class="small muted">${esc(x.url)}</div>` : ''}</td>
            <td>${statusBadge(x.status)}</td><td class="small">${esc(x.detail ?? '')}</td><td class="small">${ago(x.last_seen)}</td><td class="small">${ago(x.changed_at)}</td></tr>`).join('')}
        </table></div></div>`;
    }).join('');
  serverPanel($('#server-box'));
  timer = setInterval(() => { if (!document.hidden && !$('#server-box [data-busy]')) keepScroll(status).catch(() => {}); }, 30_000);
}

// ---------- Server: Update / Restart buttons ----------
const SERVER_BUTTONS = [
  ['update', 'Update everything', 'Download the newest version of the dashboard, the Discord bots and UEFN Trends and restart them. The dashboard is unavailable for about a minute and the page reloads by itself.'],
  ['restart-buddy', 'Restart Discord bots', 'The bots are offline for about 20 seconds. Use it when a bot is stuck or stopped answering.'],
  ['restart-trends', 'Restart UEFN Trends', 'UEFN Trends is offline for a few seconds.'],
  ['restart-dashboard', 'Restart dashboard', 'The dashboard is unavailable for a few seconds.'],
  ['restart-all', 'Restart everything', 'All three apps restart one after the other (about a minute).'],
  ['reboot', 'Reboot the server', 'The whole server restarts. Everything is offline for 1 to 2 minutes and comes back by itself. Only use this when restarting the apps did not help.'],
];

async function serverPanel(box) {
  if (!box) return;
  let lostSince = null;
  let reloadWhenDone = false;  // the dashboard restarted: reload once the run is over so the page is the new version too
  let waitUntil = 0;
  let lastStart = null;   // startedAt of the newest run we have seen
  let prevStart = null;   // ...at the moment we clicked: "waiting" lasts until a newer run shows up
  const INSTALL = 'bash /opt/euphoriax/dashboard/scripts/install-control.sh';

  const render = (s) => {
    if (!s.helperInstalled) {
      box.innerHTML = `<div class="card" style="margin-bottom:16px"><h2 style="margin-bottom:6px">Server</h2>
        <p style="margin:0 0 8px">Update and Restart buttons need a one-time install on the server (about 30 seconds):</p>
        <div class="copy"><input readonly value="${esc(INSTALL)}"><button type="button" data-copy-cmd>Copy</button></div>
        <p class="small muted" style="margin:8px 0 0">Open PowerShell, run <span class="mono">ssh root@YOUR-SERVER-IP</span>, paste the line above and press Enter. After that this box shows the buttons.</p></div>`;
      box.querySelector('[data-copy-cmd]').onclick = async () => { try { await navigator.clipboard.writeText(INSTALL); toast('Copied'); } catch { box.querySelector('input').select(); } };
      return;
    }
    const st = s.status;
    lastStart = st.startedAt ?? null;
    const waiting = Date.now() < waitUntil && st.startedAt === prevStart;
    const running = st.state === 'running' || s.queued > 0 || waiting;
    const apps = s.versions?.apps ?? [];
    const behind = apps.reduce((n, a) => n + (a.blocked ? 0 : a.behind), 0);
    const last = st.state === 'done' || st.state === 'failed'
      ? `<div class="row" style="margin-top:12px"><span class="status ${st.state === 'done' ? 'online' : 'offline'}">${dot(st.state === 'done' ? 'online' : 'offline')}Last run: ${esc(st.action === 'auto-update' ? 'Automatic update' : SERVER_BUTTONS.find((b) => b[0] === st.action)?.[1] ?? st.action)} ${st.state === 'done' ? 'finished' : 'finished with errors'}</span>
         <span class="small muted">${ago(st.finishedAt)}</span></div>${st.note ? `<div class="small" style="margin-top:4px">${esc(st.note)}</div>` : ''}` : '';
    box.innerHTML = `<div class="card strong" style="margin-bottom:16px" ${running ? 'data-busy' : ''}>
      <div class="spread"><h2>Server</h2><span class="small muted">${s.versions ? `checked for updates ${ago(s.versions.checkedAt)}` : ''}</span></div>
      ${apps.length ? `<div class="table-wrap" style="margin-top:8px"><table><tr><th>App</th><th>Version</th><th></th></tr>${apps.map((a) => `<tr><td><strong>${esc(a.label)}</strong></td>
        <td><span class="mono">${esc(a.hash)}</span> <span class="muted small">${esc(a.subject)} · ${ago(a.date)}</span></td>
        <td class="num">${a.blocked ? `<span class="tag" data-tip="The newest version did not start or build on this server, so it was skipped (or rolled back). It is tried again as soon as a newer version is pushed.">newest version failed, waiting for a fix</span>` : a.error ? `<span class="tag" data-tip="The server could not reach GitHub for this app. Log in to GitHub again on the server: gh auth login">can't check GitHub</span>` : a.behind > 0 ? `<span class="tag dark">${a.behind} update${a.behind > 1 ? 's' : ''} available</span>` : '<span class="small muted">up to date</span>'}</td></tr>`).join('')}</table></div>` : ''}
      ${running ? `<div class="row" style="margin-top:12px"><span class="status degraded">${dot('degraded')}${st.state === 'running' ? esc(st.step || 'Working…') : 'Waiting for the server to pick it up…'}</span></div>
        <div class="log mono" id="server-log" style="margin-top:8px;max-height:220px">${esc(s.log || '')}</div>`
        : `<div class="row" style="margin-top:12px">${SERVER_BUTTONS.map(([id, label], i) => `<button data-sv="${id}" class="${i === 0 ? 'primary' : ''}">${i === 0 && behind ? `${label} (${behind} new)` : label}</button>`).join('')}</div>${last}
        ${s.log && st.state !== 'idle' ? `<details style="margin-top:8px"><summary>Show details of the last run</summary><div class="log mono" style="margin-top:6px;max-height:260px">${esc(s.log)}</div></details>` : ''}
        <label class="check" style="margin-top:12px"><input type="checkbox" data-auto ${s.autoUpdate ? 'checked' : ''}> Update automatically when something new is pushed to GitHub</label>
        <div class="small muted">Checks every minute. If an app does not start after an update, it goes back to the previous version by itself and you get a Discord message.</div>`}
    </div>`;
    const lg = box.querySelector('#server-log'); if (lg) lg.scrollTop = lg.scrollHeight;
    box.querySelector('[data-auto]')?.addEventListener('change', async (e) => {
      try { await api('/api/server/auto', { json: { enabled: e.target.checked } }); toast(e.target.checked ? 'Automatic updates are on' : 'Automatic updates are off'); }
      catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
    });
    box.querySelectorAll('[data-sv]').forEach((b) => b.onclick = async () => {
      const def = SERVER_BUTTONS.find((x) => x[0] === b.dataset.sv);
      if (!confirm(`${def[1]}?\n\n${def[2]}`)) return;
      try { await api('/api/server/action', { json: { action: def[0] } }); prevStart = lastStart; waitUntil = Date.now() + 20_000; tick(); }
      catch (err) { toast(err.message); }
    });
  };

  const tick = async () => {
    if (!document.body.contains(box)) return; // left the page
    try {
      const s = await api('/api/server');
      lostSince = null;
      if (reloadWhenDone && s.status.state !== 'running') return location.reload();
      render(s);
      if (s.status.state === 'running' || s.queued > 0 || (Date.now() < waitUntil && s.status.startedAt === prevStart)) setTimeout(tick, 2000);
    } catch (err) {
      if (err.message === 'login required') return;
      lostSince ??= Date.now();
      reloadWhenDone = true;
      box.innerHTML = `<div class="card strong" style="margin-bottom:16px" data-busy><h2>Server</h2><div class="row" style="margin-top:8px"><span class="status degraded">${dot('degraded')}The dashboard is restarting. This page reconnects by itself…</span></div></div>`;
      setTimeout(tick, 3000);
    }
  };
  tick();
}

// ======================================================================
// SETUP
// ======================================================================
const GROUP_CONNECTOR = { 'Discord bots (Bot Buddy)': 'buddy', 'UEFN Trends': 'uefn', Patreon: 'patreon' };
const GROUP_INTRO = {
  'Discord bots (Bot Buddy)': 'Shows bot status, lets you answer the questions the bots could not, close tickets and approve what the bots learn.',
  'UEFN Trends': 'Shows top trends, breakouts and the trend report, and feeds the daily AI.',
  AI: 'The daily analysis that turns everything into ideas. It runs on the server with your OpenAI key, so it also works when the build PC is off.',
  'Build PC': 'The PC that builds UEFN systems from the Build queue.',
  Socials: 'Views per video. Fill in only the platforms you want. Each one starts working as soon as you save.',
  Patreon: 'Tiers, members, monthly revenue and live sales.',
  Posting: 'Where videos go when you schedule them in Outgoing.',
};

async function setup() {
  const s = await api('/api/settings');
  const groups = [...new Set(s.fields.map((f) => f.group))];
  const conn = Object.fromEntries(s.connectors.map((c) => [c.platform, c]));
  const field = (f) => `<div class="field"><label>${esc(f.label)}${f.secret && f.isSet ? ' <strong>· saved</strong>' : ''}
    ${f.options ? `<select name="${f.key}">${f.options.map((o) => `<option ${(f.value || f.options[0]) === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input name="${f.key}" ${f.secret ? 'type="password" autocomplete="new-password"' : 'autocomplete="off"'} value="${esc(f.value)}"
         placeholder="${esc(f.secret && f.isSet ? '•••••••• saved - type to replace' : f.placeholder ?? '')}">`}</label>
    ${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}</div>`;
  const copy = (label, value) => `<div class="field"><label>${label}</label><div class="copy"><input readonly value="${esc(value)}"><button type="button" data-copy="${esc(value)}">Copy</button></div></div>`;

  view.innerHTML = `
    <div class="spread" style="margin-bottom:16px"><div><h1 style="font-size:20px">Setup</h1>
      <div class="small muted">Fill in what you have and press Save. Anything you skip just stays off. Nothing here needs a restart.</div></div>
      <button class="primary" id="save-top">Save</button></div>
    <form id="settings-form" class="grid g2">
      ${groups.map((g) => `<div class="card">
        <div class="spread"><h2>${esc(g)}</h2>${GROUP_CONNECTOR[g] ? `<span class="row"><span id="test-${GROUP_CONNECTOR[g]}">${conn[GROUP_CONNECTOR[g]]?.configured ? statusBadge('online', 'filled in') : statusBadge('not_configured')}</span>
          <button type="button" data-test="${GROUP_CONNECTOR[g]}">Test</button></span>` : ''}</div>
        <p class="small muted" style="margin-top:4px">${esc(GROUP_INTRO[g] ?? '')}</p>
        ${s.fields.filter((f) => f.group === g).map(field).join('')}
        ${g === 'Discord bots (Bot Buddy)' ? copy('Instant updates: put this in Bot Buddy as DASHBOARD_WEBHOOK_URL', s.urls.buddyWebhook) : ''}
        ${g === 'Patreon' ? copy('Patreon webhook address (triggers: members create / update / delete)', s.urls.patreonWebhook) : ''}
        ${g === 'Build PC' ? `<a class="btn" href="api/machine-script">⬇ Download start file for the build PC</a>` : ''}
        ${g === 'Socials' ? `<div class="row">${['youtube', 'tiktok', 'instagram', 'twitter', 'discord'].map((p) => `<button type="button" data-test="${p}">Test ${pname(p)}</button><span id="test-${p}"></span>`).join(' ')}</div>` : ''}
      </div>`).join('')}
    </form>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2 style="margin-bottom:8px">Logins</h2>
        <ul class="list">${s.users.map((u) => `<li class="spread"><strong>${esc(u)}</strong><button data-deluser="${esc(u)}">Remove</button></li>`).join('')}</ul>
        <form id="user-form" class="row" style="margin-top:8px"><input name="name" placeholder="Name" style="width:140px" required>
          <input name="password" type="password" placeholder="New password (8+)" style="width:180px" minlength="8" required><button>Add / change password</button></form>
      </div>
      <div class="card"><h2 style="margin-bottom:8px">Keys for other tools</h2>
        <p class="small muted">Made automatically. Only needed if you connect your own scripts or bots.</p>
        ${copy('Bot / script key (header x-api-key)', s.keys.ingest)}
        ${copy('Build PC key (already in the downloaded start file)', s.keys.machine)}
        <details><summary>Examples for your own bots</summary>
          <div class="log mono" style="margin-top:6px">curl -X POST ${esc(s.urls.publicUrl)}/api/ingest/heartbeat -H "x-api-key: KEY" -H "content-type: application/json" -d '{"name":"My bot"}'

curl -X POST ${esc(s.urls.publicUrl)}/api/ingest/signal -H "x-api-key: KEY" -H "content-type: application/json" -d '{"kind":"request","text":"please make a pet system"}'

curl -X POST ${esc(s.urls.publicUrl)}/api/ingest/knowledge -H "x-api-key: KEY" -H "content-type: text/plain" --data-binary @antwoorden.txt

curl -X POST ${esc(s.urls.publicUrl)}/api/ingest/sale -H "x-api-key: KEY" -H "content-type: application/json" -d '{"product":"Pet System","amount_cents":1500}'</div></details>
      </div>
    </div>`;

  const save = async () => {
    const values = {};
    new FormData($('#settings-form')).forEach((v, k) => {
      const f = s.fields.find((x) => x.key === k);
      if (f.secret && !v) return; // empty secret box = keep what's saved
      values[k] = String(v).trim();
    });
    await api('/api/settings', { json: { values } });
  };
  $('#save-top').onclick = async () => { try { await save(); toast('Saved'); setup(); } catch (err) { toast(err.message); } };
  view.querySelectorAll('[data-test]').forEach((btn) => btn.onclick = async () => {
    const p = btn.dataset.test;
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Testing…';
    try {
      await save();
      const r = await api('/api/settings/test', { json: { platform: p } });
      $(`#test-${p}`).innerHTML = `${statusBadge(r.status)} <span class="small">${esc(r.detail ?? '')}</span>`;
    } catch (err) { toast(err.message); }
    btn.disabled = false; btn.textContent = label;
  });
  view.querySelectorAll('[data-copy]').forEach((btn) => btn.onclick = async () => {
    try { await navigator.clipboard.writeText(btn.dataset.copy); toast('Copied'); } catch { btn.previousElementSibling.select(); }
  });
  view.querySelectorAll('[data-deluser]').forEach((btn) => btn.onclick = async () => {
    if (!confirm(`Remove login "${btn.dataset.deluser}"?`)) return;
    try { await api(`/api/users/${encodeURIComponent(btn.dataset.deluser)}`, { method: 'DELETE' }); setup(); } catch (err) { toast(err.message); }
  });
  $('#user-form').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/users', { json: Object.fromEntries(new FormData(e.target)) }); toast('Saved'); setup(); } catch (err) { toast(err.message); }
  };
}
