/**
 * The post-deploy canary's journey (ADR-107), as a library so it can be
 * tested against a fake transport instead of a live deployment.
 *
 * What it proves: that a person who signs in today reaches a recommendation
 * without anyone helping -- sign in, set the profile up, mark films watched,
 * rank rounds until the activation threshold, wait for the model, and read a
 * non-empty result. Health checks answer "the process is up"; only the whole
 * journey answers "the product works", and every outage of 2026-09-05 (a
 * model service that was never deployed, a boot that refused an env var, a
 * catalog that never loaded) was invisible to `/api/health` and obvious to
 * this.
 *
 * Everything it touches goes through the public HTTP API with a real token:
 * no database handle, no privileged route. A canary that reached past the
 * API could pass while the API was broken.
 */
import { canaryEmailFor } from '../modules/auth/canary-account';

// The client's own policy version, as the onboarding screen sends it
// (apps/frontend/app/lib/api.ts CONSENT_VERSION). The canary consents to
// exactly what a person consents to; `users.isCanary`, not a withheld
// consent, is what keeps its rows out of pooling and analytics (ADR-107).
export const CANARY_CONSENT_VERSION = 'privacy-2.0';
export const CANARY_PROFILE_NAME = 'canary';

export interface CanarySettings {
  baseUrl: string;
  password: string;
  /** Journeys to run, one per numbered canary account (`--accounts N`). */
  accounts: number;
  /** Minimum spacing between any two requests: 60/min per identity. */
  requestGapMs: number;
  /**
   * Minimum spacing between two sign-ins. `POST /auth/login` is bucketed per
   * *address*, five a minute (AUTH_THROTTLE), and every journey of a 20-run
   * evidence pass signs in from the same Cron container -- so this, not the
   * per-identity limit, is what an `--accounts 20` run has to respect.
   */
  loginGapMs: number;
  /** Attempts for one request before the journey fails (429 and 5xx only). */
  maxAttemptsPerRequest: number;
  pollInitialMs: number;
  pollMaxMs: number;
  pollDeadlineMs: number;
  /** Upper bound on ranking rounds before giving up on the threshold. */
  maxRounds: number;
  /** Films to mark watched before ranking (ADR-108's suggested set). */
  watchedTitles: number;
}

export const DEFAULT_CANARY_SETTINGS: Omit<CanarySettings, 'baseUrl' | 'password'> = {
  accounts: 1,
  requestGapMs: 400,
  loginGapMs: 15_000,
  maxAttemptsPerRequest: 5,
  pollInitialMs: 2_000,
  pollMaxMs: 20_000,
  pollDeadlineMs: 300_000,
  maxRounds: 12,
  watchedTitles: 9,
};

export interface CanaryDeps {
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (line: string) => void;
}

/** A journey that ended somewhere other than a recommendation. */
export class CanaryFailure extends Error {
  constructor(
    readonly step: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'CanaryFailure';
  }
}

export interface JourneyReport {
  email: string;
  profileId: string;
  learningRounds: number;
  modelVersion: string | null;
  recommendations: number;
  durationMs: number;
}

/**
 * Delays for one poll loop: `initial`, doubling to `max`, then flat. The
 * readiness route is bucketed like everything else, so a hot loop would
 * spend the whole minute's budget and then fail the run on its own 429 --
 * exactly what the first-run e2e suite hit before it slowed to a 2s poll.
 */
export function* backoffDelays(initialMs: number, maxMs: number): Generator<number> {
  let delay = initialMs;
  for (;;) {
    yield delay;
    delay = Math.min(delay * 2, maxMs);
  }
}

export function parseCanaryArgs(argv: string[]): { accounts: number } {
  let accounts = DEFAULT_CANARY_SETTINGS.accounts;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--accounts') {
      const raw = argv[index + 1];
      index += 1;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`--accounts expects a positive integer, got ${raw ?? '(nothing)'}`);
      }
      accounts = value;
    } else {
      throw new Error(`unknown argument ${argv[index]}`);
    }
  }
  return { accounts };
}

export function canarySettingsFrom(env: NodeJS.ProcessEnv, argv: string[]): CanarySettings {
  const baseUrl = (env.API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('API_BASE_URL is required: the canary drives the deployed API over HTTP, not this process');
  }
  const password = env.CANARY_PASSWORD ?? '';
  if (!password) {
    throw new Error('CANARY_PASSWORD is required (set on the canary Cron service, never in the repository)');
  }
  return { ...DEFAULT_CANARY_SETTINGS, ...parseCanaryArgs(argv), baseUrl, password };
}

interface RequestOptions {
  /** Statuses that are an answer rather than a failure (e.g. 404 on cleanup). */
  allow?: number[];
}

/**
 * One signed-in canary account's HTTP conversation with the deployment.
 * Paces itself under the throttler, retries the two answers that mean "ask
 * again" (429, 5xx), and turns everything else into a CanaryFailure naming
 * the step -- a Cron failure notification is only useful if it says which
 * step of the journey broke.
 */
export class CanaryClient {
  private token: string | null = null;
  private lastRequestAt = 0;

  constructor(
    private readonly settings: CanarySettings,
    private readonly deps: CanaryDeps,
  ) {}

  setToken(token: string): void {
    this.token = token;
  }

  async request<T>(step: string, method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const url = `${this.settings.baseUrl}${path}`;
    const delays = backoffDelays(this.settings.pollInitialMs, this.settings.pollMaxMs);
    let lastDetail: unknown = null;
    for (let attempt = 1; attempt <= this.settings.maxAttemptsPerRequest; attempt += 1) {
      await this.pace();
      let response: Response;
      try {
        response = await this.deps.fetch(url, {
          method,
          headers: {
            'content-type': 'application/json',
            ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        // A dropped connection during a rolling deploy is the one network
        // fault worth another attempt; anything still failing on the last
        // one is reported as the outage it is.
        lastDetail = error instanceof Error ? error.message : String(error);
        if (attempt === this.settings.maxAttemptsPerRequest) {
          throw new CanaryFailure(step, `${method} ${path} never reached the deployment`, lastDetail);
        }
        await this.deps.sleep(nextDelay(delays));
        continue;
      }

      if (response.ok || options.allow?.includes(response.status)) {
        return (await readBody(response)) as T;
      }
      lastDetail = await readBody(response);
      // 429 is back-pressure, not an answer; 5xx during a rolling deploy is
      // the instance going away mid-request. Both are worth asking again.
      if (response.status !== 429 && response.status < 500) {
        throw new CanaryFailure(step, `${method} ${path} answered ${response.status}`, lastDetail);
      }
      if (attempt === this.settings.maxAttemptsPerRequest) {
        throw new CanaryFailure(step, `${method} ${path} still answered ${response.status} after ${attempt} attempts`, lastDetail);
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      await this.deps.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : nextDelay(delays));
    }
    throw new CanaryFailure(step, `${method} ${path} exhausted its attempts`, lastDetail);
  }

  private async pace(): Promise<void> {
    const since = this.deps.now() - this.lastRequestAt;
    if (this.lastRequestAt > 0 && since < this.settings.requestGapMs) {
      await this.deps.sleep(this.settings.requestGapMs - since);
    }
    this.lastRequestAt = this.deps.now();
  }
}

function nextDelay(delays: Generator<number>): number {
  return delays.next().value as number;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    // An HTML error page from a proxy in front of the API: keep enough of it
    // to recognise, not enough to fill a log line.
    return text.slice(0, 500);
  }
}

interface ReadinessRounds {
  learningRounds: number;
  firstTrainingAt: number;
  watchedTitles: number;
}
interface Capability {
  status: string;
  reason: string | null;
  modelVersion: string | null;
}
interface Readiness {
  rounds: ReadinessRounds;
  ordinalModel: Capability;
  recommendation: Capability;
}

/**
 * One account's whole journey. Every step is the route a screen calls, in
 * the order a person meets it.
 */
export async function runJourney(email: string, settings: CanarySettings, deps: CanaryDeps): Promise<JourneyReport> {
  const startedAt = deps.now();
  const client = new CanaryClient(settings, deps);

  const login = await client.request<{ access_token?: string }>('login', 'POST', '/auth/login', {
    email,
    password: settings.password,
  });
  if (!login?.access_token) {
    throw new CanaryFailure('login', `signing in as ${email} returned no access token`, login);
  }
  client.setToken(login.access_token);

  // A previous run that died mid-journey leaves a profile behind, and its
  // watched films would make this run's rounds look like progress they are
  // not. The account is the canary's alone, so every profile on it is this
  // script's own leftover -- clearing them is how a run starts from the same
  // state every time.
  const existing = await client.request<{ id: string }[]>('cleanup-previous', 'GET', '/profiles');
  for (const profile of existing ?? []) {
    await client.request('cleanup-previous', 'DELETE', `/profiles/${profile.id}`, undefined, { allow: [404] });
  }

  const profile = await client.request<{ id: string }>('onboarding', 'POST', '/profiles', {
    name: CANARY_PROFILE_NAME,
    preferredLanguage: 'ar',
    market: 'SA',
    platforms: [],
  });
  const profileId = profile?.id;
  if (!profileId) {
    throw new CanaryFailure('onboarding', 'creating the profile returned no id', profile);
  }

  try {
    await client.request('onboarding', 'PUT', '/consents', {
      consents: ['terms_privacy', 'watch_history', 'personalization_individual', 'personalization_pooled'].map((purpose) => ({
        purpose,
        version: CANARY_CONSENT_VERSION,
        granted: true,
      })),
    });

    // The same starter list the first screen offers, so a catalog that never
    // loaded fails here rather than three steps later as "no eligible
    // candidates" (the live symptom of 2026-09-05).
    const starter = await client.request<{ id: string }[]>(
      'watch-history',
      'GET',
      `/titles/starter?limit=${Math.max(settings.watchedTitles + 3, 12)}`,
    );
    const titleIds = (starter ?? []).map((title) => title.id).slice(0, settings.watchedTitles);
    if (titleIds.length < settings.watchedTitles) {
      throw new CanaryFailure(
        'watch-history',
        `the starter list offered ${titleIds.length} titles, fewer than the ${settings.watchedTitles} a first run needs`,
      );
    }
    for (const titleId of titleIds) {
      await client.request('watch-history', 'POST', `/profiles/${profileId}/watch-events`, {
        titleId,
        source: 'in_app',
      });
    }

    const readiness = () => client.request<Readiness>('rounds', 'GET', `/profiles/${profileId}/readiness`);
    let current = await readiness();
    const threshold = current.rounds.firstTrainingAt;
    for (let round = 0; current.rounds.learningRounds < threshold; round += 1) {
      if (round >= settings.maxRounds) {
        throw new CanaryFailure(
          'rounds',
          `${settings.maxRounds} rounds ranked and still ${current.rounds.learningRounds} of ${threshold} learning rounds`,
          current.rounds,
        );
      }
      const triad = await client.request<{ state: string; id?: string; titleIds?: string[] }>(
        'rounds',
        'GET',
        `/profiles/${profileId}/triads/current`,
      );
      if (triad.state !== 'ready' || !triad.id || !triad.titleIds) {
        throw new CanaryFailure('rounds', `no round to rank: the API answered '${triad.state}'`, triad);
      }
      // Any total order is a valid ranking; the canary asserts that a round
      // can be answered and counted, never what the answer should be.
      await client.request('rounds', 'POST', `/triads/${triad.id}/rank`, { ranking: [...triad.titleIds] });
      current = await readiness();
    }
    deps.log(`  ${current.rounds.learningRounds} learning round(s) of ${threshold}; waiting for the model`);

    // The threshold triggers training on its own (no CLI in the loop, BP
    // §18.1) -- what is left is to wait for it exactly as a screen does.
    const deadline = deps.now() + settings.pollDeadlineMs;
    const delays = backoffDelays(settings.pollInitialMs, settings.pollMaxMs);
    while (current.recommendation.status !== 'ready') {
      const failed = [current.ordinalModel, current.recommendation].find((capability) => capability.status === 'failed');
      if (failed) {
        throw new CanaryFailure('readiness', `the model failed for this profile (${failed.reason ?? 'no reason given'})`, current);
      }
      if (deps.now() >= deadline) {
        throw new CanaryFailure(
          'readiness',
          `no recommendation within ${Math.round(settings.pollDeadlineMs / 1000)}s of the last round`,
          current,
        );
      }
      await deps.sleep(nextDelay(delays));
      current = await readiness();
    }

    const recommendations = await client.request<{ state: string; items?: unknown[] }>(
      'recommendations',
      'GET',
      `/profiles/${profileId}/recommendations?limit=5`,
    );
    if (recommendations.state !== 'ready' || !recommendations.items?.length) {
      throw new CanaryFailure(
        'recommendations',
        `readiness said ready but the recommendations route answered '${recommendations.state}' with ${recommendations.items?.length ?? 0} item(s)`,
        recommendations,
      );
    }

    return {
      email,
      profileId,
      learningRounds: current.rounds.learningRounds,
      modelVersion: current.recommendation.modelVersion,
      recommendations: recommendations.items.length,
      durationMs: deps.now() - startedAt,
    };
  } finally {
    // The journey's rows, not its account: registration is bucketed at five
    // a minute per address, so an account this script deleted could not be
    // recreated reliably -- and the profile is what carries the triads,
    // watch events and title states (all `ON DELETE CASCADE`).
    await client
      .request('cleanup', 'DELETE', `/profiles/${profileId}`, undefined, { allow: [404] })
      .catch((error: unknown) => deps.log(`  warning: could not clean up profile ${profileId}: ${String(error)}`));
  }
}

export interface CanaryRunResult {
  reports: JourneyReport[];
  failures: { email: string; error: Error }[];
}

/** Every requested journey, in order; one failure does not stop the rest. */
export async function runCanary(settings: CanarySettings, deps: CanaryDeps): Promise<CanaryRunResult> {
  const result: CanaryRunResult = { reports: [], failures: [] };
  for (let index = 1; index <= settings.accounts; index += 1) {
    const email = canaryEmailFor(index);
    if (index > 1) {
      // See CanarySettings.loginGapMs: the sign-in bucket is per address.
      await deps.sleep(settings.loginGapMs);
    }
    deps.log(`canary ${index}/${settings.accounts}: ${email}`);
    try {
      const report = await runJourney(email, settings, deps);
      result.reports.push(report);
      deps.log(
        `  ok in ${Math.round(report.durationMs / 1000)}s: ${report.recommendations} recommendation(s) from model ${report.modelVersion ?? 'unknown'}`,
      );
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      result.failures.push({ email, error: failure });
      deps.log(`  FAILED at ${failure instanceof CanaryFailure ? failure.step : 'an unknown step'}: ${failure.message}`);
    }
  }
  return result;
}
