import { serve } from '@hono/node-server';
import { config, createProvider, createSecondJudge } from '../config.js';
import { createFetcher } from '../sources/http.js';
import { checkKey, storeKey } from './api-key.js';
import { createApp, type Services } from './app.js';

// One stray async error (e.g. from a browser tab closing mid-request) must not take down every running scan.
process.on('unhandledRejection', (err) => {
  console.error('Unbehandelter Fehler (Server läuft weiter):', err);
});

/** Built from the settings as they are now: again after the user saves a key. */
function services(): Services {
  const provider = createProvider();
  return { provider, judge: provider.mode === 'jev' ? createSecondJudge() : undefined };
}

function announce({ provider, judge }: Services): void {
  console.log(`Beurteilung: ${provider.name}${provider.mode === 'demo' ? ' – OpenRouter-Schlüssel auf der Startseite eintragen' : ` (${provider.model})`}`);
  if (judge) console.log(`Zweite Prüfung: ${judge.models.map((m) => m.model).join(' + ')}, höchstens $${judge.maxUsd} je Scan (SECOND_JUDGE=off schaltet sie ab)`);
}

const initial = services();
const app = createApp({
  ...initial,
  fetcher: createFetcher(),
  setKey: async (key) => {
    const check = await checkKey(key);
    if (!check.ok) return { error: check.reason };
    await storeKey(key);
    const next = services();
    announce(next);
    return { services: next };
  },
});

// Only this machine can reach the app.
serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`ShopWacht läuft auf http://localhost:${info.port}`);
  announce(initial);
});
