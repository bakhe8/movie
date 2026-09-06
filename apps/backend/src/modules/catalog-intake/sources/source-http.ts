import { redactUrl } from '../../../scripts/wiki-http';

// CAT-J1 (ADR-121): the intake adapters' HTTP. Same manners as the fixture
// scripts' `wiki-http.ts` (identifying User-Agent, a pause between requests,
// Retry-After honoured, hard backoff on 429/5xx, credentials redacted from
// every message) but deliberately WITHOUT its permanent on-disk cache: that
// cache exists so a fixture rebuild is offline and reproducible, whereas a
// periodic server-side pull must see today's Wikidata, not the answer it got
// the first time a URL was asked. The intake table is this path's memory.
export const INTAKE_USER_AGENT = 'movie-taste-catalog-intake/0.1 (server-side catalog intake; docs/ARCHITECTURE_DECISIONS.md ADR-121)';
export const REQUEST_DELAY_MS = 250;
const MAX_ATTEMPTS = 4;

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; text: () => Promise<string>; headers: { get: (name: string) => string | null } }>;

export interface SourceHttpOptions {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  requestDelayMs?: number;
}

export class SourceHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'SourceHttpError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SourceHttp {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly requestDelayMs: number;

  constructor(options: SourceHttpOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
    this.sleep = options.sleep ?? defaultSleep;
    this.requestDelayMs = options.requestDelayMs ?? REQUEST_DELAY_MS;
  }

  /** The body for a 200; `null` for a 404 (a stable "no such thing"); throws `SourceHttpError` otherwise, after retries on 429/5xx/network. */
  async getText(url: string, headers: Record<string, string> = {}): Promise<string | null> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.sleep(this.requestDelayMs);
        const response = await this.fetchImpl(url, { headers: { 'User-Agent': INTAKE_USER_AGENT, Accept: 'application/json', ...headers } });
        const body = await response.text();
        if (response.status === 429 || response.status >= 500) {
          lastError = new SourceHttpError(`HTTP ${response.status} for ${redactUrl(url)}`, response.status);
          const retryAfter = Number(response.headers.get('retry-after'));
          await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 3 ** attempt);
          continue;
        }
        if (response.status === 404) return null;
        if (response.status !== 200) throw new SourceHttpError(`HTTP ${response.status} for ${redactUrl(url)}`, response.status);
        return body;
      } catch (error) {
        if (error instanceof SourceHttpError && error.status !== null && error.status !== 429 && error.status < 500) throw error;
        lastError = error;
        await this.sleep(1000 * 3 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new SourceHttpError(`request failed: ${redactUrl(url)}`, null);
  }

  async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
    const body = await this.getText(url, headers);
    if (body === null) return null;
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new SourceHttpError(`non-JSON body for ${redactUrl(url)}`, 200);
    }
  }
}
