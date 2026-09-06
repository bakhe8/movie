import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { captureException } from '../../observability/observability';
import { CatalogIntakeService } from './catalog-intake.service';
import { CATALOG_JOB_TYPES, CatalogJobsService } from './catalog-jobs.service';
import type { DiscoveryCriteria } from './sources/catalog-source';

// CAT-J1 (ADR-121): the periodic trigger, on the PublicQualityRefreshService
// pattern -- one unref'd timer armed from what the database already holds,
// so a restart never re-pulls while the last pull is fresh. It does NOT run
// the pull itself: when due it enqueues one `catalog_pull` admin_jobs row
// (trigger 'schedule', no actor) so the job center stays the single ledger
// with progress, cancel, audit and the one-active-per-type rule. Off unless
// CATALOG_PULL_INTERVAL_HOURS > 0 AND CATALOG_PULL_CRITERIA parses -- tests,
// seeds and any environment that never set them cannot reach Wikidata by
// accident. Never re-armed sooner than an hour after a failure.
const HOUR_MS = 60 * 60 * 1000;
const MIN_RETRY_MS = HOUR_MS;

export function parseIntervalHours(value: string | undefined): number {
  const hours = Number(value ?? 0);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

/** The JSON criteria for the scheduled pull, or null (and a reason) when unusable. */
export function parseScheduledCriteria(value: string | undefined): { criteria: DiscoveryCriteria | null; error: string | null } {
  if (!value || !value.trim()) return { criteria: null, error: 'CATALOG_PULL_CRITERIA is not set' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { criteria: null, error: 'CATALOG_PULL_CRITERIA is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { criteria: null, error: 'CATALOG_PULL_CRITERIA must be a JSON object' };
  const criteria = parsed as DiscoveryCriteria;
  if (!Array.isArray(criteria.countryQids) || criteria.countryQids.length === 0 || !criteria.countryQids.every((qid) => /^Q[1-9]\d*$/.test(String(qid)))) {
    return { criteria: null, error: 'CATALOG_PULL_CRITERIA.countryQids must be a non-empty array of Wikidata QIDs' };
  }
  return { criteria, error: null };
}

/** Delay until the next pull: due now when nothing was ever attempted or the last attempt is older than the interval. */
export function nextRunDelayMs(lastAttemptAt: Date | null, intervalMs: number, now: Date): number {
  if (!lastAttemptAt) return 0;
  return Math.max(0, lastAttemptAt.getTime() + intervalMs - now.getTime());
}

/** One key per interval window, so two replicas waking in the same window enqueue one job between them. */
export function periodKey(now: Date, intervalMs: number): string {
  return `${CATALOG_JOB_TYPES.pull}:${Math.floor(now.getTime() / intervalMs)}`;
}

@Injectable()
export class CatalogPullScheduleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CatalogPullScheduleService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly intake: CatalogIntakeService,
    private readonly catalogJobs: CatalogJobsService,
  ) {}

  get intervalMs(): number {
    return parseIntervalHours(process.env.CATALOG_PULL_INTERVAL_HOURS) * HOUR_MS;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.intervalMs === 0) return;
    const { criteria, error } = parseScheduledCriteria(process.env.CATALOG_PULL_CRITERIA);
    if (!criteria) {
      this.logger.warn(`catalog pull schedule disabled: ${error}`);
      return;
    }
    if (!this.catalogJobs.jobCenter) {
      this.logger.warn('catalog pull schedule disabled: job center not registered');
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

  async arm(): Promise<number> {
    const { lastAttemptAt } = await this.intake.stats();
    const delay = nextRunDelayMs(lastAttemptAt, this.intervalMs, new Date());
    this.schedule(delay);
    return delay;
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.logger.log(`catalog pull in ${Math.round(delayMs / HOUR_MS)} h`);
    this.timer = setTimeout(() => void this.runOnce(), delayMs);
    this.timer.unref();
  }

  /** Enqueue one scheduled pull (never runs it inline), then re-arm. */
  async runOnce(now: Date = new Date()): Promise<{ enqueued: boolean; jobId: string | null; reason: string | null }> {
    if (this.running) return { enqueued: false, jobId: null, reason: 'already running' };
    this.running = true;
    try {
      const jobs = this.catalogJobs.jobCenter;
      const { criteria, error } = parseScheduledCriteria(process.env.CATALOG_PULL_CRITERIA);
      if (!jobs || !criteria) {
        this.schedule(Math.max(MIN_RETRY_MS, this.intervalMs));
        return { enqueued: false, jobId: null, reason: error ?? 'job center not registered' };
      }
      const { job, created } = await jobs.create(
        {
          type: CATALOG_JOB_TYPES.pull,
          params: { source: 'wikidata', criteria, discover: true, reverify: true },
          dryRun: false,
          idempotencyKey: periodKey(now, this.intervalMs),
        },
        null,
      );
      this.logger.log(`scheduled catalog pull ${created ? 'enqueued' : 'already queued'}: job ${job.id}`);
      this.schedule(this.intervalMs);
      return { enqueued: created, jobId: job.id, reason: created ? null : 'already queued for this period' };
    } catch (error) {
      // A 409 (another pull of this type still active) is expected under
      // load and is not an incident; anything else is.
      const status = (error as { getStatus?: () => number }).getStatus?.();
      const message = (error as Error).message;
      if (status === 409) {
        this.logger.warn(`scheduled catalog pull skipped: ${message}`);
      } else {
        this.logger.error(`scheduled catalog pull failed to enqueue: ${message}`);
        captureException(error, { job: 'catalog-pull-schedule' });
      }
      this.schedule(Math.max(MIN_RETRY_MS, this.intervalMs));
      return { enqueued: false, jobId: null, reason: message };
    } finally {
      this.running = false;
    }
  }
}
