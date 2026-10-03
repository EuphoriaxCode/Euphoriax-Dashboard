import { config } from '../config.js';

// OpenAI Responses API, called with plain fetch (no extra dependency). Used for the daily analysis and the caption writer.
// USD per 1M tokens, same numbers as UEFN-Trends. Unknown models use a pessimistic price so the cost line errs high.
const PRICES: Record<string, [number, number]> = {
  'gpt-5-nano': [0.05, 0.4], 'gpt-5-mini': [0.25, 2], 'gpt-5': [1.25, 10],
  'gpt-4.1-nano': [0.1, 0.4], 'gpt-4.1-mini': [0.4, 1.6], 'gpt-4.1': [2, 8], 'gpt-4o-mini': [0.15, 0.6],
};
// Web search is billed per call on top of the tokens. This is an estimate, check platform.openai.com/usage for the real number.
const SEARCH_CALL_USD = 0.01;

export function priceFor(model: string): [number, number] {
  if (PRICES[model]) return PRICES[model];
  const key = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => model.startsWith(k));
  return key ? PRICES[key] : [2.5, 10];
}

export class OpenAIError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface OpenAIRequest {
  system: string;
  user: string;
  /** Let the model search the web while it works. If OpenAI refuses the tool, we continue without it. */
  webSearch?: boolean;
  effort?: 'minimal' | 'low' | 'medium' | 'high';
  maxOutputTokens?: number;
  model?: string;
}

export interface OpenAIResult { text: string; model: string; inputTokens: number; outputTokens: number; searches: number; searchUnavailable: boolean; costUsd: number }

async function call(body: Record<string, unknown>) {
  const res = await fetch(`${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.openaiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6 * 60_000),   // thinking + searching can take a few minutes
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) throw new OpenAIError(res.status, friendly(res.status, json?.error?.message ?? res.statusText));
  return json;
}

function friendly(status: number, message: string) {
  if (status === 401) return 'OpenAI rejected the API key. Check it on the Setup page.';
  if (status === 429 && /quota|credit|billing/i.test(message)) return 'OpenAI has no credits left. Add some at platform.openai.com/settings/organization/billing.';
  if (status === 429) return 'OpenAI is rate limiting us. It is tried again at the next run.';
  return `OpenAI: ${message}`.slice(0, 300);
}

/** Reasoning models take an effort setting; the older GPT-4 family rejects it. */
const isReasoning = (model: string) => /^(gpt-5|o\d)/.test(model);

export async function openaiText(req: OpenAIRequest): Promise<OpenAIResult> {
  if (!config.openaiKey) throw new OpenAIError(400, 'No OpenAI API key yet. Add it on the Setup page (AI).');
  const model = req.model ?? config.openaiModel;
  const base: Record<string, unknown> = {
    model,
    instructions: req.system,
    input: req.user,
    max_output_tokens: req.maxOutputTokens ?? 16_000,
    ...(isReasoning(model) ? { reasoning: { effort: req.effort ?? 'medium' } } : {}),
  };

  let json: any;
  let searchUnavailable = false;
  if (req.webSearch) {
    // The tool has been called web_search and web_search_preview; try both before giving up on the web.
    for (const type of ['web_search', 'web_search_preview']) {
      try { json = await call({ ...base, tools: [{ type }] }); break; }
      catch (err) { if (!(err instanceof OpenAIError) || err.status !== 400) throw err; }
    }
    if (!json) searchUnavailable = true;
  }
  if (!json) json = await call(base);

  let text = '';
  let searches = 0;
  for (const item of json.output ?? []) {
    if (item.type === 'web_search_call') searches++;
    if (item.type === 'message') for (const c of item.content ?? []) if (c.type === 'output_text') text += c.text;
  }
  if (json.status === 'incomplete') throw new OpenAIError(502, 'OpenAI cut the answer off (too long). Try again or pick a bigger model.');
  if (!text.trim()) throw new OpenAIError(502, 'OpenAI returned an empty answer.');

  const inputTokens = json.usage?.input_tokens ?? 0;
  const outputTokens = json.usage?.output_tokens ?? 0;
  const [pin, pout] = priceFor(model);
  return { text, model, inputTokens, outputTokens, searches, searchUnavailable, costUsd: (inputTokens * pin + outputTokens * pout) / 1e6 + searches * SEARCH_CALL_USD };
}
