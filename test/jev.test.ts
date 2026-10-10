import { describe, expect, it } from 'vitest';
import { JevError, JevProvider } from '../src/decisions/jev.js';
import type { DecisionRequest } from '../src/decisions/types.js';

const req: DecisionRequest = {
  state: { produkt: 'Seife' },
  questions: { green_generic: { type: 'noul', instructions: 'Generic claim?' } },
  hints: { green_generic: 0.9 },
};

function fakeFetch(responses: Array<() => Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected call');
    return next();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ok = () =>
  new Response(
    JSON.stringify({
      model: 'typesafe/jev-1.13',
      answers: { green_generic: { type: 'noul', noul: 0.91 } },
      usage: { input_tokens: 210, output_tokens: 1, cost: 0.0000088 },
    }),
    { status: 200 },
  );

const noSleep = async () => {};

describe('JevProvider', () => {
  it('posts the OpenRouter decisions request without local hints', async () => {
    const { impl, calls } = fakeFetch([ok]);
    const jev = new JevProvider({ apiKey: 'sk-or-test', via: 'openrouter', fetch: impl, sleep: noSleep });
    const res = await jev.decide(req);

    expect(calls[0]!.url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-test');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toEqual({ model: 'typesafe/jev-1.13', state: req.state, questions: req.questions });
    expect(res).toMatchObject({ model: 'typesafe/jev-1.13', inputTokens: 210, costUsd: 0.0000088 });
    expect(res.answers.green_generic).toEqual({ type: 'noul', noul: 0.91 });
  });

  it('retries on rate limits and overload', async () => {
    const { impl, calls } = fakeFetch([() => new Response('{}', { status: 429 }), () => new Response('{}', { status: 529 }), ok]);
    const jev = new JevProvider({ apiKey: 'k', via: 'openrouter', fetch: impl, sleep: noSleep });
    await jev.decide(req);
    expect(calls).toHaveLength(3);
  });

  it('does not retry a rejected key', async () => {
    const { impl, calls } = fakeFetch([() => new Response(JSON.stringify({ error: { message: 'No auth credentials found', code: 401 } }), { status: 401 })]);
    const jev = new JevProvider({ apiKey: 'bad', via: 'openrouter', fetch: impl, sleep: noSleep });
    const err = await jev.decide(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JevError);
    expect(err).toMatchObject({ status: 401, message: expect.stringContaining('No auth credentials found') });
    expect(calls).toHaveLength(1);
  });

  it('rejects answers that do not match the questions', async () => {
    const wrong = () => new Response(JSON.stringify({ answers: { green_generic: { type: 'choice', choice: 'x' } }, usage: { input_tokens: 1 } }));
    const jev = new JevProvider({ apiKey: 'k', via: 'typesafe', fetch: fakeFetch([wrong]).impl, sleep: noSleep });
    await expect(jev.decide(req)).rejects.toThrow(/falschen Typ/);
  });

  it('uses the TypeSafe endpoint and computes cost from tokens when not reported', async () => {
    const { impl, calls } = fakeFetch([
      () => new Response(JSON.stringify({ answers: { green_generic: { type: 'noul', noul: 0.1 } }, usage: { input_tokens: 1_000_000 } })),
    ]);
    const jev = new JevProvider({ apiKey: 'k', via: 'typesafe', fetch: impl, sleep: noSleep });
    const res = await jev.decide(req);
    expect(calls[0]!.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(JSON.parse(calls[0]!.init.body as string).model).toBe('jev-latest');
    expect(res.costUsd).toBeCloseTo(0.042);
  });
});
