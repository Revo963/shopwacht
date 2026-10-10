// The user's own OpenRouter key: its shape, whether OpenRouter knows it, and the settings file it is kept in.
import { readFile, writeFile } from 'node:fs/promises';

const KEY_SHAPE = /^sk-or-[A-Za-z0-9_-]{20,200}$/;
const KEY_LINE = /^OPENROUTER_API_KEY=.*$/m;

export type KeyCheck = { ok: true } | { ok: false; reason: string };

export const looksLikeKey = (key: string) => KEY_SHAPE.test(key);

/** Asks OpenRouter whether it knows the key. Costs nothing. */
export async function checkKey(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  const unreachable = (why: string): KeyCheck => ({ ok: false, reason: `OpenRouter ist gerade nicht erreichbar (${why}). Bitte später erneut versuchen.` });
  try {
    const res = await fetchImpl('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'OpenRouter kennt diesen Schlüssel nicht. Bitte prüfen, ob er vollständig kopiert wurde.' };
    return unreachable(`Antwort ${res.status}`);
  } catch (err) {
    return unreachable((err as Error).message);
  }
}

/** Writes the key into the settings file – its one line, nothing else – and into this process. */
export async function storeKey(key: string, file = '.env'): Promise<void> {
  const line = `OPENROUTER_API_KEY=${key}`;
  const old = await readFile(file, 'utf8').catch(() => '');
  const next = KEY_LINE.test(old) ? old.replace(KEY_LINE, () => line) : `${old}${old && !old.endsWith('\n') ? '\n' : ''}${line}\n`;
  await writeFile(file, next, { mode: 0o600 });
  process.env.OPENROUTER_API_KEY = key;
}
