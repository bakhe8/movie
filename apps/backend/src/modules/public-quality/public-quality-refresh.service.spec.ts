import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { PublicQualityRefreshService, nextRunDelayMs, parseIntervalHours } from './public-quality-refresh.service';

const HOUR = 60 * 60 * 1000;

function dataSourceMock(newest: Date | null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    getRawOne: vi.fn().mockResolvedValue({ newest }),
  };
  return { getRepository: vi.fn().mockReturnValue({ createQueryBuilder: vi.fn().mockReturnValue(builder) }) } as unknown as DataSource;
}

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

describe('nextRunDelayMs', () => {
  const now = new Date('2026-09-10T00:00:00Z');

  it('is due immediately when nothing is stored yet', () => {
    expect(nextRunDelayMs(null, 168 * HOUR, now)).toBe(0);
  });

  it('is due immediately when the newest value is older than the interval', () => {
    expect(nextRunDelayMs(new Date('2026-09-01T00:00:00Z'), 168 * HOUR, now)).toBe(0);
  });

  it('waits the remaining time when the newest value is still fresh', () => {
    expect(nextRunDelayMs(new Date('2026-09-08T00:00:00Z'), 168 * HOUR, now)).toBe(5 * 24 * HOUR);
  });
});

describe('PublicQualityRefreshService', () => {
  const summary = { titlesWithImdbId: 1, notInDump: [], created: 1, unchanged: 0, superseded: 0, stale: false };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.IMDB_REFRESH_INTERVAL_HOURS;
  });

  it('does nothing at bootstrap when the interval is unset (tests and seeds never reach the network)', async () => {
    const service = new PublicQualityRefreshService(dataSourceMock(null));
    service.runner = vi.fn();

    await service.onApplicationBootstrap();
    await vi.runAllTimersAsync();

    expect(service.runner).not.toHaveBeenCalled();
  });

  it('runs at once when nothing is stored, then re-arms for one interval', async () => {
    process.env.IMDB_REFRESH_INTERVAL_HOURS = '168';
    const service = new PublicQualityRefreshService(dataSourceMock(null));
    const runner = vi.fn().mockResolvedValue(summary);
    service.runner = runner;

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(runner).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(167 * HOUR);
    expect(runner).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 * HOUR);
    expect(runner).toHaveBeenCalledTimes(2);

    service.onApplicationShutdown();
  });

  it('waits the remaining time after a restart when the stored value is still fresh', async () => {
    process.env.IMDB_REFRESH_INTERVAL_HOURS = '168';
    const service = new PublicQualityRefreshService(dataSourceMock(new Date('2026-09-08T00:00:00Z')));
    const runner = vi.fn().mockResolvedValue(summary);
    service.runner = runner;

    const delay = await service.arm();
    expect(delay).toBe(5 * 24 * HOUR);

    await vi.advanceTimersByTimeAsync(5 * 24 * HOUR - 1);
    expect(runner).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runner).toHaveBeenCalledTimes(1);

    service.onApplicationShutdown();
  });

  it('logs a failed pass and retries no sooner than an hour, never crashing the app', async () => {
    process.env.IMDB_REFRESH_INTERVAL_HOURS = '0.1';
    const service = new PublicQualityRefreshService(dataSourceMock(null));
    const runner = vi.fn().mockRejectedValueOnce(new Error('Download failed: 503')).mockResolvedValue(summary);
    service.runner = runner;

    await expect(service.runOnce()).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(0.1 * HOUR);
    expect(runner).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0.9 * HOUR);
    expect(runner).toHaveBeenCalledTimes(2);

    service.onApplicationShutdown();
  });

  it('never overlaps two passes', async () => {
    process.env.IMDB_REFRESH_INTERVAL_HOURS = '168';
    const service = new PublicQualityRefreshService(dataSourceMock(null));
    let resolve: (value: typeof summary) => void = () => {};
    service.runner = vi.fn().mockReturnValue(new Promise<typeof summary>((r) => (resolve = r)));

    const first = service.runOnce();
    const second = await service.runOnce();
    expect(second).toBeNull();
    resolve(summary);
    await expect(first).resolves.toEqual(summary);
    expect(service.runner).toHaveBeenCalledTimes(1);

    service.onApplicationShutdown();
  });
});
