import { config } from './config.js';
import { collectAll, collectOne } from './connectors/index.js';
import { buddyConnector } from './connectors/buddy.js';
import { db, kvGet, kvSet } from './db.js';
import { recoverStaleJobs } from './jobs.js';
import { checkServices } from './monitor.js';
import { publishDue } from './outgoing/publish.js';
import { runDailyAnalysis } from './ai/daily.js';
import { env } from './config.js';
import { autodetectServices } from './settings.js';
import { ACTIONS, controlState } from './serverControl.js';
import { notify } from './notify.js';
import { logActivity } from './db.js';
import { pruneSiteViews } from './siteStats.js';

function every(ms: number, name: string, fn: () => Promise<unknown> | unknown) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (err) { console.error(`[${name}]`, err); } finally { busy = false; }
  };
  setTimeout(tick, 2000);
  setInterval(tick, ms);
}

export function startScheduler() {
  // Tell us in Discord when an Update / Restart button run has finished (also when the dashboard itself was restarted).
  every(15_000, 'control-notify', async () => {
    const { status } = controlState();
    if ((status.state !== 'done' && status.state !== 'failed') || !status.finishedAt) return;
    if (status.finishedAt <= (kvGet<number>('control_notified') ?? 0)) return;
    kvSet('control_notified', status.finishedAt);
    const label = ACTIONS[status.action ?? ''] ?? status.action;
    const note = status.note ? `\n${status.note}` : '';
    if (status.action === 'auto-update' && status.state === 'done' && !status.note) return;   // nothing was actually deployed
    if (status.action === 'apply-config' && status.state === 'done') return;                  // housekeeping, only tell us when it fails
    await notify(status.state === 'done' ? `✅ **${label}** is done${note}` : `❌ **${label}** finished with errors${note}\nDetails: ${config.publicUrl}/#status`, { urgent: status.state === 'failed' });
  });
  every(15 * 60_000, 'autodetect', async () => {
    const found = await autodetectServices(env);
    for (const k of Object.keys(found)) logActivity(`Found ${k === 'BUDDY_URL' ? 'Bot Buddy' : 'UEFN Trends'} on this server and connected it`);
  });
  every(60_000, 'monitor', async () => { await checkServices(); recoverStaleJobs(); });
  every(30_000, 'publish', publishDue);
  every(config.collectEveryMin * 60_000, 'collect', collectAll);
  // Discord questions should show up fast, so the bots are checked every 2 minutes.
  every(2 * 60_000, 'buddy', () => buddyConnector.configured() && collectOne(buddyConnector));
  every(5 * 60_000, 'daily-ai', async () => {
    const today = new Date().toISOString().slice(0, 10);
    if (new Date().getHours() < config.dailyHour || kvGet<string>('daily_ai_last') === today) return;
    kvSet('daily_ai_last', today);
    await runDailyAnalysis();
  });
  every(24 * 3600_000, 'cleanup', () => {
    db.prepare('DELETE FROM activity WHERE ts < ?').run(Date.now() - 60 * 864e5);
    pruneSiteViews();
  });
}
