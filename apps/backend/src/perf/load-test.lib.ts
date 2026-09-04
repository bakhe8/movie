// ALPHA_PLAN 7.6's load test, split so the arithmetic and the report are
// unit-testable without a running server. The driver in `load-test.ts` does
// the HTTP.

export interface LoadConfig {
  baseUrl: string;
  users: number;
  triadsPerUser: number;
  watchedPerUser: number;
  concurrency: number;
  thinkTimeMs: number;
  catalogue: number;
  out: string | null;
  allowNonTestDatabase: boolean;
}

export interface Sample {
  label: string;
  ms: number;
  status: number;
}

export interface EndpointSummary {
  label: string;
  count: number;
  errors: number;
  throttled: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface RunSummary {
  endpoints: EndpointSummary[];
  totalRequests: number;
  totalErrors: number;
  totalThrottled: number;
  wallClockMs: number;
  requestsPerSecond: number;
}

export const DEFAULTS: LoadConfig = {
  baseUrl: 'http://localhost:3101/api',
  users: 150,
  triadsPerUser: 30,
  // Six watched titles are what make three rounds possible (ADR-34); the
  // 30-round target needs a deeper history, so the driver marks more.
  watchedPerUser: 12,
  concurrency: 20,
  // A real person does not answer a triad instantly. 0 saturates the server,
  // which is what a load test wants; the flag exists to model a paced session.
  thinkTimeMs: 0,
  // ALPHA_PLAN 7.6's catalogue size. `/titles` caps a page at 100, so the
  // driver pages up to this many and reports how many it actually got.
  catalogue: 500,
  out: null,
  allowNonTestDatabase: false,
};

// `--users=150 --out=report.md`, plus LOAD_* environment variables for CI.
export function parseConfig(argv: string[], env: Record<string, string | undefined> = {}): LoadConfig {
  const flags = new Map<string, string>();
  for (const argument of argv) {
    const match = /^--([a-zA-Z-]+)(?:=(.*))?$/.exec(argument);
    if (match) {
      flags.set(match[1], match[2] ?? 'true');
    }
  }
  const read = (flag: string, variable: string): string | undefined =>
    flags.get(flag) ?? env[variable] ?? undefined;
  const number = (flag: string, variable: string, fallback: number): number => {
    const raw = read(flag, variable);
    const value = Number(raw);
    return raw !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
  };

  return {
    baseUrl: (read('base-url', 'LOAD_BASE_URL') ?? DEFAULTS.baseUrl).replace(/\/$/, ''),
    users: Math.max(1, Math.trunc(number('users', 'LOAD_USERS', DEFAULTS.users))),
    triadsPerUser: Math.max(0, Math.trunc(number('triads', 'LOAD_TRIADS', DEFAULTS.triadsPerUser))),
    watchedPerUser: Math.max(3, Math.trunc(number('watched', 'LOAD_WATCHED', DEFAULTS.watchedPerUser))),
    concurrency: Math.max(1, Math.trunc(number('concurrency', 'LOAD_CONCURRENCY', DEFAULTS.concurrency))),
    thinkTimeMs: Math.trunc(number('think-time', 'LOAD_THINK_TIME_MS', DEFAULTS.thinkTimeMs)),
    catalogue: Math.max(3, Math.trunc(number('catalogue', 'LOAD_CATALOGUE', DEFAULTS.catalogue))),
    out: read('out', 'LOAD_OUT') ?? DEFAULTS.out,
    allowNonTestDatabase: flags.get('i-know-this-is-not-test') === 'true',
  };
}

// Nearest-rank on the sorted samples. No interpolation: with a few hundred
// samples per endpoint, an interpolated p99 invents a latency nobody saw.
export function percentile(sortedMs: number[], fraction: number): number {
  if (sortedMs.length === 0) {
    return 0;
  }
  const rank = Math.ceil(fraction * sortedMs.length);
  return sortedMs[Math.min(Math.max(rank, 1), sortedMs.length) - 1];
}

// 429 is counted apart from 5xx and from transport failures: a throttled
// request means the limit did its job, not that the server buckled. Reading
// them as one number is how a load test comes back falsely green or falsely
// red.
export function summarise(samples: Sample[], wallClockMs: number): RunSummary {
  const byLabel = new Map<string, Sample[]>();
  for (const sample of samples) {
    const bucket = byLabel.get(sample.label) ?? [];
    bucket.push(sample);
    byLabel.set(sample.label, bucket);
  }

  const endpoints = [...byLabel.entries()]
    .map(([label, bucket]) => {
      const sorted = bucket.map((sample) => sample.ms).sort((left, right) => left - right);
      return {
        label,
        count: bucket.length,
        errors: bucket.filter((sample) => sample.status >= 500 || sample.status === 0).length,
        throttled: bucket.filter((sample) => sample.status === 429).length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted[sorted.length - 1] ?? 0,
      };
    })
    .sort((left, right) => right.p95 - left.p95);

  return {
    endpoints,
    totalRequests: samples.length,
    totalErrors: endpoints.reduce((sum, endpoint) => sum + endpoint.errors, 0),
    totalThrottled: endpoints.reduce((sum, endpoint) => sum + endpoint.throttled, 0),
    wallClockMs,
    requestsPerSecond: wallClockMs > 0 ? (samples.length / wallClockMs) * 1000 : 0,
  };
}

// The guard this harness earned the hard way. It creates accounts and answers
// triads for real, and it is driven over HTTP -- so nothing in the request
// path tells it which database is behind the server. It therefore resolves
// the connection the same way the server does and refuses anything whose
// database name is not a test one. The escape hatch is a flag long enough to
// be deliberate, never an environment variable, because the whole failure
// mode was an environment variable that did not mean what its operator
// thought it meant.
const TEST_DATABASE = /(^|_)test$/;

export function assertTestDatabase(databaseName: string, config: LoadConfig): void {
  if (TEST_DATABASE.test(databaseName) || config.allowNonTestDatabase) {
    return;
  }
  throw new Error(
    `refusing to load-test against database "${databaseName}": the name does not end in _test, and this harness writes hundreds of accounts and thousands of triads. ` +
      'Point DATABASE_URL at postgres-test (moviedb_test), or pass --i-know-this-is-not-test if you really mean it.',
  );
}

export interface ReportContext {
  config: LoadConfig;
  catalogueSize: number;
  usersCompleted: number;
  triadsAnswered: number;
  startedAt: Date;
  notes: string[];
}

export function renderReport(summary: RunSummary, context: ReportContext): string {
  const { config } = context;
  const row = (endpoint: EndpointSummary) =>
    `| \`${endpoint.label}\` | ${endpoint.count} | ${endpoint.p50} | ${endpoint.p95} | ${endpoint.p99} | ${endpoint.max} | ${endpoint.errors} | ${endpoint.throttled} |`;

  return [
    `# Load test -- ${context.startedAt.toISOString()}`,
    '',
    `Target \`${config.baseUrl}\`. ${config.users} users x ${config.triadsPerUser} triads over a catalogue of ${context.catalogueSize} titles, ${config.concurrency} concurrent, think time ${config.thinkTimeMs}ms.`,
    '',
    `Completed journeys: **${context.usersCompleted}/${config.users}**. Triads answered: **${context.triadsAnswered}**. Wall clock: **${(summary.wallClockMs / 1000).toFixed(1)}s** (${summary.requestsPerSecond.toFixed(1)} req/s across ${summary.totalRequests} requests).`,
    '',
    '| endpoint | n | p50 ms | p95 ms | p99 ms | max ms | 5xx/failed | 429 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summary.endpoints.map(row),
    '',
    `Totals: ${summary.totalErrors} failed, ${summary.totalThrottled} throttled.`,
    ...(context.notes.length > 0 ? ['', '## Notes', ...context.notes.map((note) => `- ${note}`)] : []),
    '',
  ].join('\n');
}
