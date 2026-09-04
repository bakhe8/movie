import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  assertTestDatabase,
  parseConfig,
  percentile,
  renderReport,
  summarise,
  type Sample,
} from './load-test.lib';

const sample = (label: string, ms: number, status = 200): Sample => ({ label, ms, status });

describe('parseConfig', () => {
  it('runs ALPHA_PLAN 7.6 numbers with no arguments at all', () => {
    const config = parseConfig([], {});

    expect(config.users).toBe(150);
    expect(config.triadsPerUser).toBe(30);
  });

  it('prefers a flag over the environment, and the environment over the default', () => {
    expect(parseConfig(['--users=10'], { LOAD_USERS: '99' }).users).toBe(10);
    expect(parseConfig([], { LOAD_USERS: '99' }).users).toBe(99);
  });

  // A typo'd flag silently running the 150-user default against whatever is
  // pointed at is worse than a small run; garbage falls back, it never throws
  // mid-run, and the report prints what was actually used.
  it('falls back to the default for a value that is not a usable number', () => {
    expect(parseConfig(['--users=lots'], {}).users).toBe(DEFAULTS.users);
    expect(parseConfig(['--concurrency=-4'], {}).concurrency).toBe(DEFAULTS.concurrency);
  });

  it('never accepts fewer than three watched titles, since a triad needs three', () => {
    expect(parseConfig(['--watched=1'], {}).watchedPerUser).toBe(3);
  });

  it('drops a trailing slash so paths do not double up', () => {
    expect(parseConfig(['--base-url=http://host:3101/api/'], {}).baseUrl).toBe('http://host:3101/api');
  });
});

// A-14: the harness wrote 160 accounts into the shared dev database because
// nothing checked which database was behind the server it was pointed at.
describe('assertTestDatabase', () => {
  const config = (allow = false) => ({ ...DEFAULTS, allowNonTestDatabase: allow });

  it.each(['moviedb_test', 'test'])('accepts %j', (name) => {
    expect(() => assertTestDatabase(name, config())).not.toThrow();
  });

  it.each(['moviedb', 'movie_dev', 'production', 'test_moviedb', 'moviedbtest'])('refuses %j', (name) => {
    expect(() => assertTestDatabase(name, config())).toThrow(/refusing to load-test/);
  });

  it('names the database it refused, so the operator can see what it was really pointed at', () => {
    expect(() => assertTestDatabase('moviedb', config())).toThrow(/"moviedb"/);
  });

  it('yields to the explicit flag, and only to the flag', () => {
    expect(() => assertTestDatabase('moviedb', config(true))).not.toThrow();
    expect(parseConfig([], { LOAD_ALLOW_NON_TEST: 'true' }).allowNonTestDatabase).toBe(false);
    expect(parseConfig(['--i-know-this-is-not-test'], {}).allowNonTestDatabase).toBe(true);
  });
});

describe('percentile', () => {
  it('is nearest-rank, so every reported number is a latency that happened', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    expect(percentile(sorted, 0.5)).toBe(5);
    expect(percentile(sorted, 0.95)).toBe(10);
    expect(percentile(sorted, 0.99)).toBe(10);
  });

  it('gives 0 for no samples rather than NaN in the report', () => {
    expect(percentile([], 0.95)).toBe(0);
  });

  it('never reads past either end', () => {
    expect(percentile([7], 0)).toBe(7);
    expect(percentile([7], 1)).toBe(7);
  });
});

describe('summarise', () => {
  const samples = [
    sample('GET /a', 10),
    sample('GET /a', 20),
    sample('GET /a', 500, 429),
    sample('GET /b', 900, 503),
    sample('GET /b', 5, 0),
  ];

  // The distinction the whole report turns on: a throttled request is the
  // limit working, a 5xx or a dropped connection is the server failing.
  it('counts 429 apart from 5xx and from a request that never completed', () => {
    const summary = summarise(samples, 1000);
    const a = summary.endpoints.find((endpoint) => endpoint.label === 'GET /a')!;
    const b = summary.endpoints.find((endpoint) => endpoint.label === 'GET /b')!;

    expect(a.throttled).toBe(1);
    expect(a.errors).toBe(0);
    expect(b.errors).toBe(2);
    expect(summary.totalThrottled).toBe(1);
    expect(summary.totalErrors).toBe(2);
  });

  it('orders endpoints by p95 so the slowest is read first', () => {
    expect(summarise(samples, 1000).endpoints[0].label).toBe('GET /b');
  });

  it('reports throughput over the wall clock, not over the sum of latencies', () => {
    expect(summarise(samples, 2000).requestsPerSecond).toBeCloseTo(2.5);
  });

  it('survives an empty run without dividing by zero', () => {
    const summary = summarise([], 0);

    expect(summary.totalRequests).toBe(0);
    expect(summary.requestsPerSecond).toBe(0);
  });
});

describe('renderReport', () => {
  it('states what was actually achieved, not what was asked for', () => {
    const report = renderReport(summarise([sample('GET /a', 10)], 1000), {
      config: { ...DEFAULTS, users: 150, triadsPerUser: 30 },
      catalogueSize: 315,
      usersCompleted: 148,
      triadsAnswered: 2201,
      startedAt: new Date('2026-09-04T00:00:00Z'),
      notes: ['catalogue is only 315 titles'],
    });

    expect(report).toContain('**148/150**');
    expect(report).toContain('**2201**');
    expect(report).toContain('315 titles');
    expect(report).toContain('| `GET /a` |');
  });
});
