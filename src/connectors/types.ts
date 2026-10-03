export interface Connector {
  /** Shown in the status page, e.g. "YouTube". */
  name: string;
  /** Platform key used in the database, e.g. "youtube". */
  platform: string;
  configured(): boolean;
  /** What env vars to set when not configured. */
  setup: string;
  /** Pulls fresh data into the database. Returns a short status line. */
  collect(): Promise<string>;
}

export async function getJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : ({} as T);
}

export const toMs = (d?: string | number | null) =>
  d === undefined || d === null ? undefined : typeof d === 'number' ? (d < 1e12 ? d * 1000 : d) : Date.parse(d);
