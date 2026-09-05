import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PublicQualitySource } from '../../entities/public-quality-source.entity';
import { refreshImdbRatings, type LoadImdbRatingsSummary } from '../../scripts/load-imdb-ratings';
import { IMDB_SOURCE } from './public-quality.constants';
import { captureException } from '../../observability/observability';

// Keeps Public Quality a living value (ALPHA_PLAN 5.3 follow-up): IMDb's
// dump is refreshed daily at the source, so when IMDB_REFRESH_INTERVAL_HOURS
// is set the app re-downloads and reloads it whenever the newest stored IMDb
// value is older than that. Off by default (0/unset): tests, seeds and
// one-off scripts never reach the network by accident. No queue or
// scheduler package: one unref'd timer, re-armed after each pass, exactly
// like the loader's own append-only semantics -- a pass that finds nothing
// changed writes nothing (BP §11.3).
const HOUR_MS = 60 * 60 * 1000;
// Never re-arm sooner than this after a failure, so a broken download does
// not hammer the dataset endpoint.
const MIN_RETRY_MS = HOUR_MS;

export function parseIntervalHours(value: string | undefined): number {
  const hours = Number(value ?? 0);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

// Delay until the next pass: due immediately when nothing is stored or the
// newest value is older than the interval, otherwise the remaining time.
export function nextRunDelayMs(newestCapturedAt: Date | null, intervalMs: number, now: Date): number {
  if (!newestCapturedAt) {
    return 0;
  }
  return Math.max(0, newestCapturedAt.getTime() + intervalMs - now.getTime());
}

export type RefreshRunner = (dataSource: DataSource, log: (line: string) => void) => Promise<LoadImdbRatingsSummary>;

@Injectable()
export class PublicQualityRefreshService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PublicQualityRefreshService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // Overridable for tests; production runs the real pass with --fetch.
  runner: RefreshRunner = (dataSource, log) => refreshImdbRatings(dataSource, { fetch: true, log });

  get intervalMs(): number {
    return parseIntervalHours(process.env.IMDB_REFRESH_INTERVAL_HOURS) * HOUR_MS;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.intervalMs === 0) {
      return;
    }
    await this.arm();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async newestCapturedAt(): Promise<Date | null> {
    const row = await this.dataSource
      .getRepository(PublicQualitySource)
      .createQueryBuilder('q')
      .select('MAX(q."capturedAt")', 'newest')
      .where('q.source = :source', { source: IMDB_SOURCE })
      .getRawOne<{ newest: Date | string | null }>();
    return row?.newest ? new Date(row.newest) : null;
  }

  // Schedules the next pass from what the database already holds, so a
  // restart never re-downloads a dump that is still fresh.
  async arm(): Promise<number> {
    const delay = nextRunDelayMs(await this.newestCapturedAt(), this.intervalMs, new Date());
    this.schedule(delay);
    return delay;
  }

  private schedule(delayMs: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.logger.log(`IMDb ratings refresh in ${Math.round(delayMs / HOUR_MS)} h`);
    this.timer = setTimeout(() => void this.runOnce(), delayMs);
    // Never keeps the process alive on its own (tests, graceful shutdown).
    this.timer.unref();
  }

  async runOnce(): Promise<LoadImdbRatingsSummary | null> {
    if (this.running) {
      return null;
    }
    this.running = true;
    try {
      const summary = await this.runner(this.dataSource, (line) => this.logger.log(line));
      this.schedule(this.intervalMs);
      return summary;
    } catch (error) {
      this.logger.error(`IMDb ratings refresh failed: ${(error as Error).message}`);
      captureException(error, { job: 'imdb-ratings-refresh' });
      this.schedule(Math.max(MIN_RETRY_MS, this.intervalMs));
      return null;
    } finally {
      this.running = false;
    }
  }
}
