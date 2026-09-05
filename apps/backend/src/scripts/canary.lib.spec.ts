import { describe, expect, it } from 'vitest';
import {
  backoffDelays,
  canarySettingsFrom,
  CanaryFailure,
  CanaryNotConfigured,
  DEFAULT_CANARY_SETTINGS,
  parseCanaryArgs,
  runCanary,
  runJourney,
  type CanaryDeps,
  type CanarySettings,
} from './canary.lib';

// A deployment the canary can walk, small enough to bend into every failure
// worth asserting. Records every request so a test can say what the journey
// actually did -- the cleanup DELETE especially, which no response reveals.
interface FakeOptions {
  /** Readiness polls after the threshold before `recommendation` turns ready. */
  pollsBeforeReady?: number;
  /** Never ready: the model-service-down case of 2026-09-05. */
  neverReady?: boolean;
  /** Readiness reports the model failed, with this reason. */
  failWith?: string;
  /** Profiles the previous run left behind. */
  leftoverProfiles?: string[];
  /** The account does not exist yet: login 401s until it is registered. */
  unregistered?: boolean;
  /** The account exists under another password: login 401s, register 409s. */
  wrongPassword?: boolean;
  /** Titles the starter list offers. */
  starterTitles?: number;
  /** How many times each of these `METHOD /path` answers 429 first. */
  throttle?: Record<string, number>;
  recommendationItems?: number;
}

function fakeDeployment(options: FakeOptions = {}) {
  const calls: string[] = [];
  let ranked = 0;
  let pollsSinceThreshold = 0;
  let profiles = [...(options.leftoverProfiles ?? [])];
  const throttled: Record<string, number> = { ...options.throttle };
  const starterTitles = options.starterTitles ?? 12;
  const threshold = 3;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  const readiness = () => {
    let status = 'not_ready';
    if (ranked >= threshold) {
      pollsSinceThreshold += 1;
      const ready = !options.neverReady && !options.failWith && pollsSinceThreshold > (options.pollsBeforeReady ?? 0);
      status = options.failWith ? 'failed' : ready ? 'ready' : 'processing';
    }
    const capability = { status, reason: options.failWith ?? null, modelVersion: status === 'ready' ? 'canary-model-1' : null };
    return json({
      rounds: { learningRounds: ranked, firstTrainingAt: threshold, watchedTitles: starterTitles },
      ordinalModel: capability,
      semanticProfile: capability,
      recommendation: capability,
      availability: { status: 'not_ready', reason: 'no_availability_data_source', modelVersion: null },
    });
  };

  const fetchImpl = (async (url: string, init: { method: string }) => {
    const path = String(url).replace('https://api.example.test', '');
    const key = `${init.method} ${path.split('?')[0]}`;
    calls.push(key);
    if (throttled[key] > 0) {
      throttled[key] -= 1;
      return new Response('{"message":"ThrottlerException: Too Many Requests"}', { status: 429 });
    }
    if (key === 'POST /auth/login') {
      if (options.unregistered || options.wrongPassword) {
        return json({ message: 'Invalid email or password' }, 401);
      }
      return json({ access_token: 'canary-token', user: { id: 'u1' } }, 201);
    }
    if (key === 'POST /auth/register') {
      if (options.wrongPassword) {
        return json({ message: 'Email already registered' }, 409);
      }
      return json({ access_token: 'canary-token', user: { id: 'u1' } }, 201);
    }
    if (key === 'GET /profiles') {
      return json(profiles.map((id) => ({ id })));
    }
    if (init.method === 'DELETE' && /^\/profiles\/[^/]+$/.test(path)) {
      profiles = profiles.filter((id) => id !== path.split('/')[2]);
      return new Response(null, { status: 204 });
    }
    if (key === 'POST /profiles') {
      profiles.push('p1');
      return json({ id: 'p1', name: 'canary' }, 201);
    }
    if (key === 'PUT /consents') {
      return json([]);
    }
    if (key === 'GET /titles/starter') {
      return json(Array.from({ length: starterTitles }, (_, index) => ({ id: `title-${index}` })));
    }
    if (key === 'POST /profiles/p1/watch-events') {
      return json({ id: 'w1' }, 201);
    }
    if (key === 'GET /profiles/p1/readiness') {
      return readiness();
    }
    if (key === 'GET /profiles/p1/triads/current') {
      return json({ state: 'ready', id: `triad-${ranked}`, titleIds: ['title-0', 'title-1', 'title-2'] });
    }
    if (init.method === 'POST' && /^\/triads\/[^/]+\/rank$/.test(path)) {
      ranked += 1;
      return json({ id: 'triad', status: 'completed' }, 201);
    }
    if (key === 'GET /profiles/p1/recommendations') {
      return json({
        state: 'ready',
        items: Array.from({ length: options.recommendationItems ?? 5 }, (_, index) => ({ titleId: `title-${index}` })),
      });
    }
    return json({ message: 'not found' }, 404);
  }) as unknown as typeof globalThis.fetch;

  return { fetchImpl, calls, profilesNow: () => profiles };
}

function deps(fetchImpl: typeof globalThis.fetch): CanaryDeps & { slept: number[] } {
  let clock = 1_000;
  const slept: number[] = [];
  return {
    fetch: fetchImpl,
    // No real waiting: the clock moves by exactly what was asked for, so the
    // deadline logic is exercised without the test taking that long.
    sleep: async (ms: number) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    log: () => {},
    slept,
  };
}

const SETTINGS: CanarySettings = {
  ...DEFAULT_CANARY_SETTINGS,
  baseUrl: 'https://api.example.test',
  password: 'canary-password',
  requestGapMs: 0,
  loginGapMs: 0,
};

describe('canary arguments and settings', () => {
  it('defaults to a single journey and accepts --accounts N', () => {
    expect(parseCanaryArgs([])).toEqual({ accounts: 1 });
    expect(parseCanaryArgs(['--accounts', '20'])).toEqual({ accounts: 20 });
  });

  it('refuses an account count that is not a positive integer, and unknown flags', () => {
    expect(() => parseCanaryArgs(['--accounts', '0'])).toThrow(/positive integer/);
    expect(() => parseCanaryArgs(['--accounts'])).toThrow(/positive integer/);
    expect(() => parseCanaryArgs(['--dry-run'])).toThrow(/unknown argument/);
  });

  it('reports an unset target or password as "not configured", never as a failure', () => {
    // The Cron service can exist before the owner sets the variable; the
    // runner turns this into a warning and exit 0, not a page.
    expect(() => canarySettingsFrom({}, [])).toThrow(CanaryNotConfigured);
    expect(() => canarySettingsFrom({}, [])).toThrow(/API_BASE_URL/);
    expect(() => canarySettingsFrom({ API_BASE_URL: 'https://api.kolme.app' }, [])).toThrow(CanaryNotConfigured);
    expect(() => canarySettingsFrom({ API_BASE_URL: 'https://api.kolme.app' }, [])).toThrow(/CANARY_PASSWORD/);
    const settings = canarySettingsFrom({ API_BASE_URL: 'https://api.kolme.app/', CANARY_PASSWORD: 'x' }, ['--accounts', '3']);
    expect(settings.baseUrl).toBe('https://api.kolme.app');
    expect(settings.accounts).toBe(3);
  });
});

describe('backoffDelays', () => {
  it('doubles from the initial delay and then holds at the cap', () => {
    const delays = backoffDelays(2_000, 20_000);
    expect([0, 1, 2, 3, 4, 5].map(() => delays.next().value)).toEqual([2_000, 4_000, 8_000, 16_000, 20_000, 20_000]);
  });
});

describe('the canary journey', () => {
  it('walks sign-in to recommendation and reports the model that served it', async () => {
    const fake = fakeDeployment({ pollsBeforeReady: 2 });
    const report = await runJourney('canary@kolme.app', SETTINGS, deps(fake.fetchImpl));

    expect(report).toMatchObject({
      email: 'canary@kolme.app',
      profileId: 'p1',
      learningRounds: 3,
      modelVersion: 'canary-model-1',
      recommendations: 5,
    });
    // The journey a person makes, in order -- not a health check.
    expect(fake.calls).toContain('POST /auth/login');
    expect(fake.calls).toContain('PUT /consents');
    expect(fake.calls.filter((call) => call === 'POST /profiles/p1/watch-events')).toHaveLength(9);
    expect(fake.calls.filter((call) => call.startsWith('POST /triads/'))).toHaveLength(3);
    expect(fake.calls).toContain('GET /profiles/p1/recommendations');
  });

  it('leaves the account behind and nothing else: the profile it created is deleted', async () => {
    const fake = fakeDeployment();
    await runJourney('canary@kolme.app', SETTINGS, deps(fake.fetchImpl));
    expect(fake.calls).toContain('DELETE /profiles/p1');
    expect(fake.profilesNow()).toEqual([]);
    // Never the account itself: registration is bucketed at 5/min per
    // address, so a deleted canary could not be recreated reliably.
    expect(fake.calls.some((call) => call.startsWith('DELETE /auth'))).toBe(false);
  });

  it('clears what a crashed previous run left behind before starting', async () => {
    const fake = fakeDeployment({ leftoverProfiles: ['old-1', 'old-2'] });
    await runJourney('canary@kolme.app', SETTINGS, deps(fake.fetchImpl));
    expect(fake.calls).toContain('DELETE /profiles/old-1');
    expect(fake.calls).toContain('DELETE /profiles/old-2');
  });

  it('fails at `readiness` when the model never arrives, and still cleans up', async () => {
    const fake = fakeDeployment({ neverReady: true });
    const error = await runJourney('canary@kolme.app', SETTINGS, deps(fake.fetchImpl)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CanaryFailure);
    expect((error as CanaryFailure).step).toBe('readiness');
    expect((error as CanaryFailure).message).toMatch(/no recommendation within 300s/);
    expect(fake.calls).toContain('DELETE /profiles/p1');
  });

  it('fails as soon as readiness reports the model failed, without waiting out the deadline', async () => {
    const fake = fakeDeployment({ failWith: 'model_service_error' });
    const error = await runJourney('canary@kolme.app', SETTINGS, deps(fake.fetchImpl)).catch((caught: unknown) => caught);

    expect((error as CanaryFailure).step).toBe('readiness');
    expect((error as CanaryFailure).message).toMatch(/model_service_error/);
  });

  it('fails at `watch-history` when the catalog is too small for a first run', async () => {
    const fake = fakeDeployment({ starterTitles: 4 });
    const error = await runJourney('canary@kolme.app', SETTINGS, deps(fake.fetchImpl)).catch((caught: unknown) => caught);

    expect((error as CanaryFailure).step).toBe('watch-history');
    expect((error as CanaryFailure).message).toMatch(/offered 4 titles/);
  });

  it('treats 429 as back-pressure and asks again rather than failing the run', async () => {
    const fake = fakeDeployment({ throttle: { 'GET /profiles/p1/readiness': 2 } });
    const report = await runJourney('canary@kolme.app', SETTINGS, deps(fake.fetchImpl));
    expect(report.recommendations).toBe(5);
  });

  it('registers the account the first time it is used, then walks the journey', async () => {
    const fake = fakeDeployment({ unregistered: true });
    const report = await runJourney('canary@kolme.app', SETTINGS, deps(fake.fetchImpl));

    expect(fake.calls).toContain('POST /auth/register');
    expect(report.recommendations).toBe(5);
  });

  it('says so plainly when the account exists under another password', async () => {
    const fake = fakeDeployment({ wrongPassword: true });
    const error = await runJourney('canary@kolme.app', SETTINGS, deps(fake.fetchImpl)).catch((caught: unknown) => caught);

    expect((error as CanaryFailure).step).toBe('login');
    expect((error as CanaryFailure).message).toMatch(/CANARY_PASSWORD is not its password/);
    // Never a second registration attempt: the address is bucketed at 5/min.
    expect(fake.calls.filter((call) => call === 'POST /auth/register')).toHaveLength(1);
  });

  it('fails at the step that answered, when the answer is not back-pressure', async () => {
    const fetchImpl = (async () => new Response('{"message":"Not Found"}', { status: 404 })) as unknown as typeof globalThis.fetch;
    const error = await runJourney('canary@kolme.app', SETTINGS, deps(fetchImpl)).catch((caught: unknown) => caught);

    expect((error as CanaryFailure).step).toBe('login');
    expect((error as CanaryFailure).message).toMatch(/answered 404/);
  });
});

describe('runCanary', () => {
  it('walks one numbered account per journey and keeps going after a failure', async () => {
    const good = fakeDeployment();
    const fetchImpl = (async (url: string, init: { method: string; body?: string }) => {
      // The second account is broken all the way down: one journey that
      // cannot start must not hide the other journeys' results.
      if (String(url).endsWith('/auth/login') && String(init.body).includes('canary+2@kolme.app')) {
        return new Response('{"message":"Internal Server Error"}', { status: 500 });
      }
      return good.fetchImpl(url as never, init as never);
    }) as unknown as typeof globalThis.fetch;

    const result = await runCanary({ ...SETTINGS, accounts: 3 }, deps(fetchImpl));

    expect(result.reports.map((report) => report.email)).toEqual(['canary@kolme.app', 'canary+3@kolme.app']);
    expect(result.failures.map((failure) => failure.email)).toEqual(['canary+2@kolme.app']);
  });
});
