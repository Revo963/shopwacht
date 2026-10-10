import type { Answer, DecisionProvider, DecisionRequest, DecisionResult } from './types.js';

const JEV_PRESETS = {
  openrouter: {
    endpoint: 'https://openrouter.ai/api/alpha/decisions',
    model: 'typesafe/jev-1.13',
  },
  typesafe: {
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
  },
} as const;

/** Published input price; OpenRouter also returns the exact cost per call. */
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 524, 529]);

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'JevError';
  }
}

export interface JevOptions {
  apiKey: string;
  via: keyof typeof JEV_PRESETS;
  model?: string;
  endpoint?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Minimum gap between request starts; 55 ms keeps us under 1,200 requests/min. */
  minIntervalMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class JevProvider implements DecisionProvider {
  readonly mode = 'jev' as const;
  readonly name: string;
  readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextSlot = 0;

  constructor(private readonly opts: JevOptions) {
    const preset = JEV_PRESETS[opts.via];
    this.name = `Jev via ${opts.via === 'openrouter' ? 'OpenRouter' : 'TypeSafe'}`;
    this.model = opts.model ?? preset.model;
    this.endpoint = opts.endpoint ?? preset.endpoint;
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async decide(req: DecisionRequest, signal?: AbortSignal): Promise<DecisionResult> {
    const body = JSON.stringify({ model: this.model, state: req.state, questions: req.questions });
    const maxRetries = this.opts.maxRetries ?? 4;

    for (let attempt = 0; ; attempt++) {
      await this.waitForSlot();
      let res: Response;
      try {
        res = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: this.headers(),
          body,
          signal: withTimeout(signal, this.opts.timeoutMs ?? 20_000),
        });
      } catch (err) {
        if (signal?.aborted || attempt >= maxRetries) {
          throw new JevError(`Jev nicht erreichbar: ${(err as Error).message}`);
        }
        await this.sleep(backoff(attempt));
        continue;
      }

      if (res.ok) return this.parse(await res.json(), req);

      const detail = await errorMessage(res);
      if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await this.sleep(retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        continue;
      }
      throw new JevError(`Jev-Anfrage fehlgeschlagen (${res.status}): ${detail}`, res.status);
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.opts.via === 'openrouter') {
      h['X-Title'] = 'ShopWacht';
    }
    return h;
  }

  private async waitForSlot(): Promise<void> {
    const gap = this.opts.minIntervalMs ?? 55;
    const now = Date.now();
    const start = Math.max(now, this.nextSlot);
    this.nextSlot = start + gap;
    if (start > now) await this.sleep(start - now);
  }

  private parse(json: unknown, req: DecisionRequest): DecisionResult {
    const data = json as {
      model?: string;
      answers?: Record<string, Answer>;
      usage?: { input_tokens?: number; cost?: number };
    };
    const answers = data.answers ?? {};
    for (const [id, q] of Object.entries(req.questions)) {
      const a = answers[id];
      if (!a || a.type !== q.type) {
        throw new JevError(`Antwort auf Frage "${id}" fehlt oder hat den falschen Typ.`);
      }
    }
    const inputTokens = data.usage?.input_tokens ?? 0;
    return {
      answers,
      model: data.model ?? this.model,
      inputTokens,
      costUsd: data.usage?.cost ?? inputTokens * USD_PER_INPUT_TOKEN,
    };
  }
}

function backoff(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; detail?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.detail) return JSON.stringify(parsed.detail);
  } catch {
    // not JSON
  }
  return text.slice(0, 300) || res.statusText;
}
