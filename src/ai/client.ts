import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

let client: Anthropic | null = null;
export function claude() {
  if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY is not set');
  return (client ??= new Anthropic({ apiKey: config.anthropicKey }));
}

// USD per million tokens, for the cost line on each report.
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-fable-5-1': [10, 50], 'claude-haiku-4-5': [1, 5],
};
export function estimateCost(model: string, usage: { input_tokens: number; output_tokens: number }) {
  const [i, o] = PRICES[model] ?? [4, 20];
  return (usage.input_tokens * i + usage.output_tokens * o) / 1e6;
}

/** Pulls the last ```json fenced block (or bare JSON object) out of a reply. */
export function extractJson<T>(text: string): T {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].pop()?.[1];
  const raw = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(raw) as T;
}
