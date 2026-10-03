#!/usr/bin/env node
// Euphoriax build machine worker.
// Runs on the UEFN PC. Pulls prompts from the dashboard's build queue one at a time and runs them with
// Claude Code (your Claude subscription, logged in via `claude` once), streaming the log back.
// No dependencies - needs Node 20+ and the `claude` CLI on PATH.
//
//   DASHBOARD_URL=https://euphoriax.net/dashboard MACHINE_KEY=... MACHINE_NAME=build-pc \
//   WORK_DIR="C:\\UEFN\\MyProject" node worker.mjs

import { spawn } from 'node:child_process';
import { hostname } from 'node:os';

const URL_BASE = (process.env.DASHBOARD_URL ?? 'http://localhost:3200').replace(/\/$/, '');
const KEY = process.env.MACHINE_KEY ?? '';
const NAME = process.env.MACHINE_NAME ?? hostname();
const WORK_DIR = process.env.WORK_DIR ?? process.cwd();
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';
// Unattended runs can't answer permission prompts, so by default Claude may use every tool on this PC.
// Narrow it with e.g. CLAUDE_ARGS="--permission-mode acceptEdits --allowedTools mcp__unreal"
const CLAUDE_ARGS = (process.env.CLAUDE_ARGS ?? '--dangerously-skip-permissions').split(' ').filter(Boolean);
const POLL_MS = Number(process.env.POLL_SECONDS ?? 20) * 1000;
const LIMIT_WAIT_MS = Number(process.env.LIMIT_WAIT_MINUTES ?? 30) * 60_000;
const PREAMBLE = process.env.PROMPT_PREAMBLE ??
  'You are the Euphoriax UEFN build machine working unattended. Before anything else, read MCP_RULES.md from ' +
  'https://github.com/EuphoriaxCode/UEFN-MCP-Guidelines (and the topics/ file for the area you touch) and follow it. ' +
  'Work until the task is complete and verified in-game where possible, take screenshots of the result, and finish with ' +
  'a short summary of what you built, where it is, and anything that still needs a human.\n\nTASK:\n';

if (!KEY) { console.error('Set MACHINE_KEY'); process.exit(1); }

let busy = false;
let currentTitle = '';

async function call(path, body) {
  const res = await fetch(`${URL_BASE}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function heartbeat() {
  try { await call('/api/machine/heartbeat', { name: NAME, busy, detail: busy ? `building: ${currentTitle}` : 'idle, waiting for prompts' }); }
  catch (err) { console.error('heartbeat failed:', err.message); }
}
setInterval(heartbeat, 60_000);

/** Turns Claude Code's stream-json events into readable log lines. */
function describe(evt) {
  if (evt.type === 'assistant') {
    return (evt.message?.content ?? []).map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_use') return `> ${b.name} ${JSON.stringify(b.input ?? {}).slice(0, 160)}`;
      return '';
    }).filter(Boolean).join('\n');
  }
  if (evt.type === 'result') return `\n=== ${evt.subtype ?? 'result'} · ${Math.round((evt.duration_ms ?? 0) / 60000)} min ===\n${evt.result ?? ''}`;
  return '';
}

async function runJob(job) {
  busy = true;
  currentTitle = job.title;
  await heartbeat();
  console.log(`\n▶ #${job.id} ${job.title}`);

  // The prompt goes in through stdin: Windows caps command lines at ~32K characters.
  const prompt = job.kind === 'analysis' ? job.prompt : PREAMBLE + job.prompt;
  const child = spawn(CLAUDE_BIN, ['-p', '--output-format', 'stream-json', '--verbose', ...CLAUDE_ARGS], {
    cwd: WORK_DIR, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.on('error', (err) => { stderr += `Could not start ${CLAUDE_BIN}: ${err.message}\n`; });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);

  let buffer = '';
  let pending = '';
  let result = null;
  let stderr = '';
  let cancelled = false;

  child.stdout.on('data', (d) => {
    buffer += d.toString();
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      try {
        const evt = JSON.parse(line);
        if (evt.type === 'result') result = evt;
        const text = describe(evt);
        if (text) { pending += text + '\n'; process.stdout.write(text + '\n'); }
      } catch { pending += line + '\n'; }
    }
  });
  child.stderr.on('data', (d) => { stderr += d.toString(); pending += d.toString(); });

  // Flush the log every few seconds; the dashboard answers with cancel=true if we pressed Cancel.
  const flusher = setInterval(async () => {
    const chunk = pending;
    pending = '';
    try {
      const r = await call(`/api/machine/jobs/${job.id}/log`, { chunk });
      if (r?.cancel && !cancelled) { cancelled = true; console.log('Cancelled from dashboard'); child.kill(); }
    } catch (err) { pending = chunk + pending; console.error('log upload failed:', err.message); }
  }, 5000);

  const code = await new Promise((resolve) => child.on('close', resolve));
  clearInterval(flusher);
  if (pending) await call(`/api/machine/jobs/${job.id}/log`, { chunk: pending }).catch(() => {});

  const text = `${result?.result ?? ''}\n${stderr}`;
  const hitLimit = /usage limit|rate limit|limit reached|resets at/i.test(text) && (code !== 0 || result?.is_error);
  if (cancelled) {
    await call(`/api/machine/jobs/${job.id}/finish`, { status: 'failed', summary: 'Cancelled from the dashboard' });
  } else if (hitLimit) {
    // Claude subscription limit: put the job back and wait for the limit to reset.
    await call(`/api/machine/jobs/${job.id}/finish`, { status: 'requeue', summary: 'Claude usage limit hit, waiting to retry' });
    console.log(`Usage limit hit; sleeping ${LIMIT_WAIT_MS / 60000} min`);
    busy = false;
    currentTitle = '';
    await heartbeat();
    await sleep(LIMIT_WAIT_MS);
    return;
  } else {
    const ok = code === 0 && !result?.is_error;
    const summary = (result?.result ?? stderr ?? '').trim().slice(-1500) || `claude exited with code ${code}`;
    await call(`/api/machine/jobs/${job.id}/finish`, { status: ok ? 'done' : 'failed', summary, output: result?.result ?? '' });
  }
  busy = false;
  currentTitle = '';
  await heartbeat();
}

console.log(`Euphoriax worker "${NAME}" -> ${URL_BASE} (work dir ${WORK_DIR})`);
await heartbeat();
for (;;) {
  try {
    const job = await call('/api/machine/claim', { name: NAME });
    if (job) { await runJob(job); continue; }
  } catch (err) {
    console.error(err.message);
    busy = false;
  }
  await sleep(POLL_MS);
}
