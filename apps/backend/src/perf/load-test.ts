import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseConfig,
  renderReport,
  summarise,
  type LoadConfig,
  type Sample,
} from './load-test.lib';

// ALPHA_PLAN 7.6: 150 users x 30 triads over the real catalogue, driven over
// HTTP against a running backend so the numbers include the guards, the
// validation pipe and the ORM -- not a synthetic in-process harness that
// measures none of that.
//
// It creates accounts and answers triads for real. Point it at a throwaway
// database (postgres-test, or a copy), never at `movie-postgres` while other
// sessions are testing against it -- CLAUDE.md §3.
//
//   npm run perf:load -- --users=150 --triads=30 --out=perf-report.md
//
// The rate limit applies: a client this fast exceeds the app-wide 60/min per
// user long before 30 rounds, so 429s are expected and reported on their own
// line rather than counted as failures. `--think-time` models a paced human
// session instead.

interface Timed<T> {
  value: T | null;
  status: number;
}

class Driver {
  readonly samples: Sample[] = [];

  constructor(private readonly config: LoadConfig) {}

  async call<T>(label: string, path: string, init: RequestInit = {}): Promise<Timed<T>> {
    const started = performance.now();
    let status = 0;
    let value: T | null = null;
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      });
      status = response.status;
      // A 4xx body is read too: it is what tells us *why* a journey stopped.
      const text = await response.text();
      value = text.length > 0 ? (JSON.parse(text) as T) : null;
    } catch (error) {
      // status 0 = the request never completed (connection refused, socket
      // hang-up). Distinct from a 5xx, which means the server answered.
      status = 0;
      value = null;
      void error;
    }
    this.samples.push({ label, ms: Math.round(performance.now() - started), status });
    return { value, status };
  }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface Title {
  id: string;
}

interface Triad {
  id?: string;
  titleIds?: string[];
  state?: string;
}

interface JourneyResult {
  answered: number;
  recommendationsReady: boolean;
}

// One virtual user: register, open a profile, mark a watch history, then
// answer triads and read recommendations -- the journey ALPHA_PLAN 7.6 names.
async function journey(
  driver: Driver,
  config: LoadConfig,
  catalogue: Title[],
  index: number,
): Promise<JourneyResult> {
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const email = `load-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}@example.com`;

  const registered = await driver.call<{ access_token: string }>('POST /auth/register', '/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'CorrectHorseBattery1', firstName: 'Load', lastName: 'Test' }),
  });
  const token = registered.value?.access_token;
  if (!token) {
    return { answered: 0, recommendationsReady: false };
  }

  const profile = await driver.call<{ id: string }>('POST /profiles', '/profiles', {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({ name: `Load ${index}` }),
  });
  const profileId = profile.value?.id;
  if (!profileId) {
    return { answered: 0, recommendationsReady: false };
  }

  // Each user watches a different slice of the catalogue, so the candidate
  // pools differ between users the way they would in production.
  const offset = (index * config.watchedPerUser) % Math.max(1, catalogue.length);
  for (let step = 0; step < config.watchedPerUser; step += 1) {
    const title = catalogue[(offset + step) % catalogue.length];
    await driver.call('PATCH /profiles/:id/titles/:id/state', `/profiles/${profileId}/titles/${title.id}/state`, {
      method: 'PATCH',
      headers: auth(token),
      body: JSON.stringify({ state: 'watched' }),
    });
  }

  let answered = 0;
  for (let round = 0; round < config.triadsPerUser; round += 1) {
    const current = await driver.call<Triad>(
      'GET /profiles/:id/triads/current',
      `/profiles/${profileId}/triads/current`,
      { headers: auth(token) },
    );
    const triad = current.value;
    // `need_more_watched` (or a 429) ends this user's rounds early; the
    // report counts what was actually answered rather than what was asked for.
    if (!triad?.id || !triad.titleIds || triad.titleIds.length !== 3) {
      break;
    }
    const ranked = await driver.call('POST /triads/:id/rank', `/triads/${triad.id}/rank`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ ranking: [...triad.titleIds] }),
    });
    if (ranked.status >= 400) {
      break;
    }
    answered += 1;
    if (config.thinkTimeMs > 0) {
      await sleep(config.thinkTimeMs);
    }
  }

  // The response is a list once a snapshot exists and a `{ state }` object
  // while it does not (ADR-81). Which one came back decides whether this run
  // measured the ranking path at all, so it is reported rather than assumed.
  const recommendations = await driver.call<unknown>(
    'GET /profiles/:id/recommendations',
    `/profiles/${profileId}/recommendations`,
    { headers: auth(token) },
  );
  return { answered, recommendationsReady: Array.isArray(recommendations.value) };
}

// A fixed-size pool rather than 150 simultaneous journeys: the point is a
// steady arrival rate the server can be measured under, not a thundering herd
// that only measures how fast Node can open sockets.
async function runPool<T>(size: number, total: number, worker: (index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, total) }, async () => {
      for (let index = next++; index < total; index = next++) {
        results.push(await worker(index));
      }
    }),
  );
  return results;
}

// `/titles` caps a page at 100 (ListTitlesQueryDto), so the catalogue is read
// a page at a time and the run continues with whatever the target actually
// holds -- reported, not silently padded.
async function readCatalogue(driver: Driver, config: LoadConfig, token: string): Promise<Title[]> {
  const titles: Title[] = [];
  for (let page = 1; titles.length < config.catalogue; page += 1) {
    const listed = await driver.call<{ data?: Title[]; items?: Title[] } | Title[]>(
      'GET /titles',
      `/titles?limit=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = listed.value;
    const batch = Array.isArray(body) ? body : (body?.data ?? body?.items ?? []);
    if (batch.length === 0) {
      break;
    }
    titles.push(...batch);
  }
  return titles.slice(0, config.catalogue);
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2), process.env);
  const driver = new Driver(config);
  const notes: string[] = [];
  const startedAt = new Date();

  // The catalogue is read through an account of its own, because /titles is
  // authenticated like every other route.
  const seed = await driver.call<{ access_token: string }>('POST /auth/register', '/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `load-reader-${Date.now()}@example.com`,
      password: 'CorrectHorseBattery1',
      firstName: 'Load',
      lastName: 'Reader',
    }),
  });
  if (!seed.value?.access_token) {
    throw new Error(`cannot reach ${config.baseUrl} (status ${seed.status}); is the backend running?`);
  }
  const catalogue = await readCatalogue(driver, config, seed.value.access_token);
  if (catalogue.length === 0) {
    throw new Error('the catalogue came back empty; seed the target database first');
  }
  if (catalogue.length < config.catalogue) {
    notes.push(
      `catalogue is ${catalogue.length} titles, not the ${config.catalogue} asked for -- candidate pools repeat more than they would in production.`,
    );
  }

  const clock = performance.now();
  const journeys = await runPool(config.concurrency, config.users, (index) =>
    journey(driver, config, catalogue, index),
  );
  const wallClockMs = Math.round(performance.now() - clock);

  const summary = summarise(driver.samples, wallClockMs);
  const triadsAnswered = journeys.reduce((sum, result) => sum + result.answered, 0);
  const ranked = journeys.filter((result) => result.recommendationsReady).length;
  if (ranked < journeys.length) {
    notes.push(
      `${ranked}/${journeys.length} users got a ranked list; the rest were still un-trained, so their /recommendations timing is the cheap not-ready branch, not the ranking path. Run the model service alongside to measure that.`,
    );
  }
  const target = config.users * config.triadsPerUser;
  if (triadsAnswered < target) {
    notes.push(
      `${triadsAnswered}/${target} triads answered -- users stop early when the pool runs out or the rate limit bites (${summary.totalThrottled} x 429).`,
    );
  }

  const report = renderReport(summary, {
    config,
    catalogueSize: catalogue.length,
    usersCompleted: journeys.filter((result) => result.answered > 0).length,
    triadsAnswered,
    startedAt,
    notes,
  });
  if (config.out) {
    const path = resolve(process.cwd(), config.out);
    writeFileSync(path, report, 'utf8');
    console.log(`report written to ${path}`);
  }
  console.log(report);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
