// The user's OpenRouter key is entered on the start page: checked, written to the settings file and used at once.
// The page never shows a key, and another website must not be able to post one.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoProvider } from '../src/decisions/demo.js';
import { checkKey, storeKey } from '../src/server/api-key.js';
import { createApp } from '../src/server/app.js';
import type { Fetcher } from '../src/sources/http.js';
import { FakeProvider } from './helpers.js';

const KEY = `sk-or-v1-${'0123456789abcdef'.repeat(4)}`;
const offline: Fetcher = {
  async get() {
    throw new Error('offline');
  },
};
const post = (key: string, headers: Record<string, string> = {}) => ({ method: 'POST', body: new URLSearchParams({ key }), headers });

describe('the key field on the start page', () => {
  type SetKey = NonNullable<Parameters<typeof createApp>[0]['setKey']>;
  const localApp = (answer: Awaited<ReturnType<SetKey>> = { services: { provider: new FakeProvider() } }) => {
    const setKey = vi.fn<SetKey>(async () => answer);
    return { app: createApp({ provider: new DemoProvider(), fetcher: offline, setKey }), setKey };
  };

  it('is offered while the app runs in demo mode, with where to get a key', async () => {
    const html = await (await localApp().app.request('/')).text();
    expect(html).toContain('name="key"');
    expect(html).toContain('type="password"');
    expect(html).toContain('https://openrouter.ai/keys');
    expect(html).toContain('Demo-Modus');
  });

  it('uses a saved key at once: no demo notice any more', async () => {
    const { app, setKey } = localApp();
    const saved = await app.request('/schluessel', post(KEY));
    expect(saved.status).toBe(200);
    expect(setKey).toHaveBeenCalledWith(KEY);
    const html = await saved.text();
    expect(html).toContain('Schlüssel gespeichert');
    expect(html).not.toContain('Demo-Modus');
    expect(await (await app.request('/')).text()).not.toContain('Demo-Modus');
  });

  it('never shows the key, saved or refused', async () => {
    const { app } = localApp();
    expect(await (await app.request('/schluessel', post(KEY))).text()).not.toContain(KEY);
    const refusing = localApp({ error: 'OpenRouter kennt diesen Schlüssel nicht.' });
    const refused = await refusing.app.request('/schluessel', post(KEY));
    expect(refused.status).toBe(400);
    const html = await refused.text();
    expect(html).toContain('OpenRouter kennt diesen Schlüssel nicht.');
    expect(html).toContain('name="key"');
    expect(html).not.toContain(KEY);
  });

  it.each(['', 'abc', 'sk-or-v1-short', `${KEY}\nPUBLIC_BETA=on`, `${KEY} `.repeat(3)])('refuses %j without asking anyone', async (key) => {
    const { app, setKey } = localApp();
    const res = await app.request('/schluessel', post(key));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('sieht nicht nach einem OpenRouter-Schlüssel aus');
    expect(setKey).not.toHaveBeenCalled();
  });

  it('refuses a key posted from another website', async () => {
    const { app, setKey } = localApp();
    expect((await app.request('/schluessel', post(KEY, { origin: 'https://evil.example', host: 'localhost:3000' }))).status).toBe(403);
    expect((await app.request('/schluessel', post(KEY, { origin: 'null', 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    // Another program's page on this machine (localhost on another port) is not this page either.
    expect((await app.request('/schluessel', post(KEY, { origin: 'http://localhost:8080', host: 'localhost:3000', 'sec-fetch-site': 'same-site' }))).status).toBe(403);
    // A browser too old to say where the request comes from, with an origin that tells nothing.
    expect((await app.request('/schluessel', post(KEY, { origin: 'null' }))).status).toBe(403);
    expect(setKey).not.toHaveBeenCalled();
  });

  it('accepts the form of its own page, whose origin a browser sends as "null"', async () => {
    // What Chrome 154 sends for this form: the pages carry Referrer-Policy: no-referrer.
    const { app, setKey } = localApp();
    expect((await app.request('/schluessel', post(KEY, { origin: 'null', host: 'localhost:3000', 'sec-fetch-site': 'same-origin' }))).status).toBe(200);
    expect(setKey).toHaveBeenCalledTimes(1);
  });

  it('is not offered by an app that was given no way to store a key', async () => {
    const plain = createApp({ provider: new DemoProvider(), fetcher: offline });
    expect((await plain.request('/schluessel', post(KEY))).status).toBe(404);
    const html = await (await plain.request('/')).text();
    expect(html).not.toContain('name="key"');
    expect(html).toContain('Demo-Modus');
  });
});

describe('asking OpenRouter about a key', () => {
  it('accepts a key OpenRouter knows', async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const known = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ data: { label: 'sk-or-v1-012…def', limit: 5, usage: 0.37 } }), { status: 200 });
    }) as typeof fetch;
    expect(await checkKey(KEY, known)).toEqual({ ok: true });
    expect(calls).toEqual([{ url: 'https://openrouter.ai/api/v1/key', auth: `Bearer ${KEY}` }]);
  });

  it('says so when OpenRouter does not know the key', async () => {
    // OpenRouter's answer to a made-up key, 2026-10-10.
    const unknown = (async () => new Response('{"error":{"message":"User not found.","code":401}}', { status: 401 })) as typeof fetch;
    expect(await checkKey(KEY, unknown)).toEqual({ ok: false, reason: 'OpenRouter kennt diesen Schlüssel nicht. Bitte prüfen, ob er vollständig kopiert wurde.' });
  });

  it('does not call an unreachable OpenRouter a wrong key', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const busy = (async () => new Response('', { status: 503 })) as typeof fetch;
    for (const impl of [down, busy]) {
      const result = await checkKey(KEY, impl);
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ reason: expect.stringContaining('nicht erreichbar') });
    }
  });
});

describe('writing the key to the settings file', () => {
  const before = process.env.OPENROUTER_API_KEY;
  let dir = '';
  const file = async (content?: string) => {
    dir = await mkdtemp(join(tmpdir(), 'shopwacht-key-'));
    const path = join(dir, '.env');
    if (content !== undefined) await writeFile(path, content);
    return path;
  };
  afterEach(async () => {
    if (before === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = before;
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the file when there is none', async () => {
    const path = await file();
    await storeKey(KEY, path);
    expect(await readFile(path, 'utf8')).toBe(`OPENROUTER_API_KEY=${KEY}\n`);
    expect(process.env.OPENROUTER_API_KEY).toBe(KEY);
  });

  it('replaces the one line and leaves every other setting alone', async () => {
    const path = await file('# Einstellungen\nOPENROUTER_API_KEY=\nPORT=3000\nMAX_PRODUCTS=250\n');
    await storeKey(KEY, path);
    expect(await readFile(path, 'utf8')).toBe(`# Einstellungen\nOPENROUTER_API_KEY=${KEY}\nPORT=3000\nMAX_PRODUCTS=250\n`);
    await storeKey(`${KEY}ff`, path);
    expect(await readFile(path, 'utf8')).toBe(`# Einstellungen\nOPENROUTER_API_KEY=${KEY}ff\nPORT=3000\nMAX_PRODUCTS=250\n`);
  });

  it('adds the line to a file that has none', async () => {
    const path = await file('PORT=3000');
    await storeKey(KEY, path);
    expect(await readFile(path, 'utf8')).toBe(`PORT=3000\nOPENROUTER_API_KEY=${KEY}\n`);
  });
});
