import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { CatalogPullScheduleService, nextRunDelayMs, parseIntervalHours, parseScheduledCriteria, periodKey } from './catalog-pull-schedule.service';

const HOUR = 60 * 60 * 1000;
const CRITERIA = JSON.stringify({ countryQids: ['Q79'], minSitelinks: 6, limit: 20 });

describe('parseIntervalHours', () => {
  it.each([
    [undefined, 0],
    ['', 0],
    ['0', 0],
    ['-5', 0],
    ['abc', 0],
    ['168', 168],
    ['1.5', 1.5],
  ])('%s -> %s', (value, expected) => {
    expect(parseIntervalHours(value)).toBe(expected);
  });
});

describe('parseScheduledCriteria', () => {
  it('accepts a JSON object with valid country QIDs', () => {
    expect(parseScheduledCriteria(CRITERIA)).toEqual({ criteria: { countryQids: ['Q79'], minSitelinks: 6, limit: 20 }, error: null });
  });
  it('refuses missing, malformed, or country-less criteria with a reason', () => {
    expect(parseScheduledCriteria(undefined).error).toContain('not set');
    expect(parseScheduledCriteria('{oops').error).toContain('valid JSON');
    expect(parseScheduledCriteria('[]').error).toContain('JSON object');
    expect(parseScheduledCriteria('{"countryQids":[]}').error).toContain('countryQids');
    expect(parseScheduledCriteria('{"countryQids":["Egypt"]}').error).toContain('countryQids');
  });
});

describe('nextRunDelayMs / periodKey', () => {
  const now = new Date('2026-09-10T00:00:00Z');
  it('is due at once with no attempt or a stale one, and waits the remainder otherwise', () => {
    expect(nextRunDelayMs(null, 24 * HOUR, now)).toBe(0);
    expect(nextRunDelayMs(new Date('2026-09-01T00:00:00Z'), 24 * HOUR, now)).toBe(0);
    expect(nextRunDelayMs(new Date('2026-09-09T18:00:00Z'), 24 * HOUR, now)).toBe(18 * HOUR);
  });
  it('gives two callers in the same window the same idempotency key', () => {
    expect(periodKey(now, 24 * HOUR)).toBe(periodKey(new Date(now.getTime() + 5 * HOUR), 24 * HOUR));
    expect(periodKey(now, 24 * HOUR)).not.toBe(periodKey(new Date(now.getTime() + 25 * HOUR), 24 * HOUR));
    expect(periodKey(now, 24 * HOUR)).toMatch(/^catalog_pull:\d+$/);
  });
});

function build(lastAttemptAt: Date | null, create = vi.fn(async () => ({ job: { id: 'job-1' }, created: true }))) {
  const intake = { stats: vi.fn(async () => ({ total: 0, byStatus: {}, byBlockerCode: {}, lastAttemptAt })) };
  const catalogJobs = { jobCenter: { create } };
  const service = new CatalogPullScheduleService(intake as never, catalogJobs as never);
  return { service, create, intake };
}

describe('CatalogPullScheduleService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CATALOG_PULL_INTERVAL_HOURS;
    delete process.env.CATALOG_PULL_CRITERIA;
  });

  it('does nothing at bootstrap when the interval is unset or the criteria are missing', async () => {
    const { service, intake } = build(null);
    await service.onApplicationBootstrap();
    expect(intake.stats).not.toHaveBeenCalled();
    process.env.CATALOG_PULL_INTERVAL_HOURS = '24';
    await service.onApplicationBootstrap();
    expect(intake.stats).not.toHaveBeenCalled();
  });

  it('arms from the last attempt in the database and enqueues one scheduled pull with a period key and no actor', async () => {
    process.env.CATALOG_PULL_INTERVAL_HOURS = '24';
    process.env.CATALOG_PULL_CRITERIA = CRITERIA;
    const { service, create } = build(new Date('2026-09-09T18:00:00Z'));
    const delay = await service.arm();
    expect(delay).toBe(18 * HOUR);
    expect(create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(18 * HOUR);
    expect(create).toHaveBeenCalledTimes(1);
    const [dto, actor] = create.mock.calls[0] as unknown as [Record<string, unknown>, unknown];
    expect(actor).toBeNull();
    expect(dto).toMatchObject({ type: 'catalog_pull', dryRun: false, params: { source: 'wikidata', discover: true, reverify: true, criteria: { countryQids: ['Q79'] } } });
    expect(dto.idempotencyKey).toMatch(/^catalog_pull:\d+$/);
    service.onApplicationShutdown();
  });

  it('treats a 409 (another pull still active) as a skip, not an incident, and re-arms', async () => {
    process.env.CATALOG_PULL_INTERVAL_HOURS = '24';
    process.env.CATALOG_PULL_CRITERIA = CRITERIA;
    const create = vi.fn(async () => {
      throw new ConflictException({ reason: 'type_active' });
    });
    const { service } = build(null, create as never);
    const result = await service.runOnce();
    expect(result.enqueued).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    service.onApplicationShutdown();
  });

  it('never runs two enqueues concurrently', async () => {
    process.env.CATALOG_PULL_INTERVAL_HOURS = '24';
    process.env.CATALOG_PULL_CRITERIA = CRITERIA;
    let release!: () => void;
    const create = vi.fn(() => new Promise<{ job: { id: string }; created: boolean }>((resolve) => (release = () => resolve({ job: { id: 'j' }, created: true }))));
    const { service } = build(null, create as never);
    const first = service.runOnce();
    const second = await service.runOnce();
    expect(second).toEqual({ enqueued: false, jobId: null, reason: 'already running' });
    release();
    expect(await first).toMatchObject({ enqueued: true, jobId: 'j' });
    service.onApplicationShutdown();
  });
});
