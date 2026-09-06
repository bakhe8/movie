import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, LessThanOrEqual, Not, QueryDeepPartialEntity, Repository } from 'typeorm';
import { AdminJob, AdminJobStatus } from '../../entities/admin-job.entity';
import { ContentFeature } from '../../entities/content-feature.entity';
import { Title } from '../../entities/title.entity';
import { FINGERPRINT_V2_DIMENSIONS, FINGERPRINT_V3_DIMENSIONS } from '../../entities/title-fingerprint.type';
import { captureException } from '../../observability/observability';
import { republishFingerprint } from '../../scripts/republish-fingerprint.lib';
import { sanitizeError } from '../training/training-jobs.service';
import type { Actor } from './admin-catalog.service';
import { AuditService } from '../audit/audit.service';
import { CreateAdminJobDto, ListAdminJobsQueryDto } from './dto/admin.dto';

// A unit of work reports progress and checks for a cooperative cancel
// between chunks; it never sees the row directly, so it cannot skip the
// bookkeeping (attempts, lease, sanitized errors) AdminJobsService owns.
export interface AdminJobRunContext {
  dryRun: boolean;
  reportProgress: (progress: Record<string, unknown>) => Promise<void>;
  isCancelled: () => Promise<boolean>;
}

export type AdminJobHandler = (params: Record<string, unknown>, ctx: AdminJobRunContext) => Promise<Record<string, unknown>>;

export interface AdminJobTypeDef {
  key: string;
  // Plain-language description the frontend shows next to the type in the
  // registration form -- admin-copy.ts's discipline extends to this list.
  description: string;
  handler: AdminJobHandler;
}

const BACKOFF_MS = [5_000, 30_000, 120_000];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const DEFAULT_SWEEP_INTERVAL_MS = 15_000;
const SWEEP_BATCH = 10;
const RETENTION_DAYS = 30;
// Every handler here is in-process DB work, no external network call -- a
// row stuck `running` past this is almost certainly a crashed process, not
// slow legitimate work (unlike training_jobs' 10-minute lease for an
// external service).
const RUNNING_LEASE_MS = 5 * 60 * 1000;
const PROGRESS_CHECKPOINT = 25;

// ADMIN-W5 (plan §17.2, §18 W5): the one durable task queue behind every
// allowlisted admin job. `create()` writes the row then fires `dispatch()`
// without awaiting it -- the HTTP response returns the queued row at once,
// the caller polls `get()` for progress/result, matching the durable-queue
// pattern `training_jobs` established (ADR-100) rather than a synchronous
// long-running request. Unlike training_jobs, a handler here runs entirely
// in-process (no external service to poll), so `dispatch()` both claims and
// executes the unit of work in one step.
@Injectable()
export class AdminJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminJobsService.name);
  readonly sweepIntervalMs: number;
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;
  private readonly handlers: Record<string, AdminJobTypeDef>;

  constructor(
    @InjectRepository(AdminJob)
    private readonly rows: Repository<AdminJob>,
    @InjectRepository(Title)
    private readonly titles: Repository<Title>,
    @InjectRepository(ContentFeature)
    private readonly features: Repository<ContentFeature>,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    const raw = Number(config.get<string>('ADMIN_JOBS_SWEEP_INTERVAL_MS'));
    this.sweepIntervalMs = Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_SWEEP_INTERVAL_MS;
    this.handlers = {
      republish_fingerprints: {
        key: 'republish_fingerprints',
        description:
          'يعيد نشر بصمة الفيلم من أحدث تحليل معتمد (content_features غير المُستبدَلة) على كل الأفلام، أو فيلم واحد إن حُدِّد titleId. لا يخترع قيمة، ولا يمس فيلماً بلا بصمة منشورة أصلاً.',
        handler: (params, ctx) => this.republishFingerprintsHandler(params, ctx),
      },
    };
  }

  // Disabled under test so suites drive runDue() by hand; disabled with
  // ADMIN_JOBS_SWEEP_INTERVAL_MS=0 when an external scheduler owns it.
  onModuleInit(): void {
    if (this.sweepIntervalMs === 0 || this.config.get<string>('NODE_ENV') === 'test') {
      return;
    }
    this.sweepTimer = setInterval(() => {
      void this.runDue().catch((error: unknown) => {
        this.logger.error(`admin-jobs sweep failed: ${this.describe(error)}`);
        captureException(error, { stage: 'admin-jobs.sweep' });
      });
    }, this.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  // The allowlist itself, for the registration form -- never a free-text
  // job-type input on the frontend.
  listTypes(): { type: string; description: string }[] {
    return Object.values(this.handlers).map((def) => ({ type: def.key, description: def.description }));
  }

  async create(dto: CreateAdminJobDto, actor: Actor): Promise<{ job: AdminJob; created: boolean }> {
    if (!this.handlers[dto.type]) {
      throw new ConflictException({
        statusCode: 409,
        message: `Unknown job type '${dto.type}'`,
        error: 'Conflict',
        reason: 'unknown_type',
        allowlist: Object.keys(this.handlers),
      });
    }
    if (dto.idempotencyKey) {
      const existing = await this.rows.findOne({ where: { idempotencyKey: dto.idempotencyKey } });
      if (existing) {
        return { job: existing, created: false };
      }
    }
    const row = await this.rows.save(
      this.rows.create({
        type: dto.type,
        status: 'queued',
        params: dto.params ?? null,
        dryRun: dto.dryRun ?? false,
        attempts: 0,
        nextAttemptAt: new Date(),
        requestedBy: actor.id,
        idempotencyKey: dto.idempotencyKey ?? null,
      }),
    );
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'admin.job.create',
      resource: 'admin_job',
      resourceId: row.id,
      status: 'ok',
      reason: `${dto.type}${dto.dryRun ? ' (dry run)' : ''}${dto.params ? ` params=${JSON.stringify(dto.params)}` : ''}`,
      ip: actor.ip,
    });
    void this.dispatch(row).catch((error: unknown) => {
      this.logger.error(`admin-jobs dispatch ${row.id} failed: ${this.describe(error)}`);
      captureException(error, { stage: 'admin-jobs.dispatch', adminJobId: row.id });
    });
    return { job: row, created: true };
  }

  async list(query: ListAdminJobsQueryDto) {
    const where = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status as AdminJobStatus } : {}),
    };
    const [items, total] = await this.rows.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }

  async get(id: string): Promise<AdminJob> {
    const row = await this.rows.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Job not found');
    }
    return row;
  }

  // Cancelling a queued row ends it at once (it never ran); cancelling a
  // running one is cooperative -- the flag is set, and the handler's own
  // checkpoint (isCancelled) stops it and dispatch() records the final
  // 'cancelled' status once it does. A terminal row cannot be cancelled.
  async cancel(id: string, actor: Actor): Promise<AdminJob> {
    const row = await this.get(id);
    if (row.status === 'queued') {
      await this.rows.update({ id, status: 'queued' }, { status: 'cancelled', finishedAt: new Date() });
    } else if (row.status === 'running') {
      await this.rows.update({ id }, { cancelRequested: true });
    } else {
      throw new ConflictException({ statusCode: 409, message: `Job already ${row.status}`, error: 'Conflict', reason: 'already_terminal' });
    }
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'admin.job.cancel',
      resource: 'admin_job',
      resourceId: id,
      status: 'ok',
      reason: `was ${row.status}`,
      ip: actor.ip,
    });
    return this.get(id);
  }

  // Reclaims a stuck 'running' row past its lease, dispatches any 'queued'
  // row whose backoff elapsed (the fire-and-forget dispatch in create() can
  // be lost to a process restart between the write and the call), then
  // purges old terminal rows. Also callable directly (tests).
  async runDue(now: Date = new Date()): Promise<{ reclaimed: number; dispatched: number; purged: number }> {
    if (this.sweeping) {
      return { reclaimed: 0, dispatched: 0, purged: 0 };
    }
    this.sweeping = true;
    try {
      const stuck = await this.rows.find({
        where: { status: 'running', updatedAt: LessThan(new Date(now.getTime() - RUNNING_LEASE_MS)) },
        take: SWEEP_BATCH,
      });
      let reclaimed = 0;
      for (const row of stuck) {
        await this.guard(`reclaim ${row.id}`, async () => {
          await this.retryOrFail(row, row.attempts, 'The job stopped responding (process likely restarted)', now);
          reclaimed += 1;
        });
      }
      const due = await this.rows.find({
        where: { status: 'queued', nextAttemptAt: LessThanOrEqual(now) },
        order: { nextAttemptAt: 'ASC' },
        take: SWEEP_BATCH,
      });
      for (const row of due) {
        await this.guard(`dispatch ${row.id}`, () => this.dispatch(row, now));
      }
      const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const purged = await this.rows.delete({ status: 'succeeded', updatedAt: LessThan(cutoff) });
      return { reclaimed, dispatched: due.length, purged: purged.affected ?? 0 };
    } finally {
      this.sweeping = false;
    }
  }

  private async guard(what: string, step: () => Promise<void>): Promise<void> {
    try {
      await step();
    } catch (error) {
      this.logger.error(`[admin-jobs] ${what} failed: ${this.describe(error)}`);
      captureException(error, { stage: `admin-jobs.${what.split(' ')[0]}` });
    }
  }

  // The lease: one statement, `UPDATE ... WHERE id = ? AND status = 'queued'`
  // -- two callers racing for the same row (the create()-time dispatch and a
  // sweep tick) produce exactly one winner, in whatever process each runs in.
  private async claim(row: AdminJob, now: Date): Promise<AdminJob | null> {
    const attempts = row.attempts + 1;
    const claimed = { status: 'running' as const, attempts, startedAt: now, cancelRequested: false };
    const result = await this.rows.update({ id: row.id, status: 'queued' }, claimed);
    return result.affected === 1 ? { ...row, ...claimed } : null;
  }

  private async dispatch(row: AdminJob, now: Date = new Date()): Promise<void> {
    const claimed = await this.claim(row, now);
    if (!claimed) {
      return;
    }
    const def = this.handlers[claimed.type];
    if (!def) {
      // The row was created under an allowlist that has since dropped this
      // type (a deploy removed a handler) -- fail it visibly rather than
      // loop forever.
      await this.rows.update({ id: claimed.id }, { status: 'failed', finishedAt: new Date(), lastError: `Unknown type '${claimed.type}'` });
      return;
    }
    const ctx: AdminJobRunContext = {
      dryRun: claimed.dryRun,
      reportProgress: async (progress) => {
        await this.rows.update({ id: claimed.id }, { progress } as unknown as QueryDeepPartialEntity<AdminJob>);
      },
      isCancelled: async () => {
        const fresh = await this.rows.findOne({ where: { id: claimed.id }, select: { cancelRequested: true } });
        return fresh?.cancelRequested ?? false;
      },
    };
    try {
      const result = await def.handler(claimed.params ?? {}, ctx);
      const cancelled = await ctx.isCancelled();
      await this.rows.update(
        { id: claimed.id },
        { status: cancelled ? 'cancelled' : 'succeeded', result, finishedAt: new Date(), lastError: null } as unknown as QueryDeepPartialEntity<AdminJob>,
      );
    } catch (error) {
      await this.retryOrFail(claimed, claimed.attempts, this.describe(error), now);
    }
  }

  private async retryOrFail(row: AdminJob, attempts: number, message: string, now: Date): Promise<void> {
    const lastError = sanitizeError(message);
    if (attempts >= MAX_ATTEMPTS) {
      this.logger.error(`[admin-jobs] ${row.id} (${row.type}) failed after ${attempts} attempts: ${lastError}`);
      captureException(new Error(lastError), { adminJobId: row.id, jobType: row.type });
      await this.rows.update({ id: row.id }, { status: 'failed', attempts, lastError, finishedAt: now });
      return;
    }
    const delay = BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    await this.rows.update(
      { id: row.id },
      { status: 'queued', attempts, lastError, nextAttemptAt: new Date(now.getTime() + delay) },
    );
  }

  private describe(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  // The first allowlisted type (plan §17.2, item 1): folds every current,
  // non-superseded content_features row back onto the title's published
  // fingerprint, exactly the standalone republish-fingerprint.ts script's
  // logic, now behind dry-run/progress/cancel/audit instead of a CLI a human
  // has to remember to run.
  private async republishFingerprintsHandler(params: Record<string, unknown>, ctx: AdminJobRunContext): Promise<Record<string, unknown>> {
    const titleId = typeof params.titleId === 'string' ? params.titleId : undefined;
    const candidates = await this.titles.find({
      where: { fingerprint: Not(IsNull()), ...(titleId ? { id: titleId } : {}) },
    });
    let processed = 0;
    let titlesChanged = 0;
    let keysChanged = 0;
    const sample: { titleId: string; internalId: string; changes: unknown }[] = [];
    for (const title of candidates) {
      if (processed % PROGRESS_CHECKPOINT === 0 && (await ctx.isCancelled())) {
        break;
      }
      const currentRows = await this.features.find({ where: { titleId: title.id, supersededBy: IsNull() } });
      const { fingerprint, changes } = republishFingerprint(
        title.fingerprint as unknown as Record<string, unknown>,
        currentRows.map((row) => ({ featureKey: row.featureKey, value: row.value, uncertainty: row.uncertainty })),
        FINGERPRINT_V2_DIMENSIONS,
        FINGERPRINT_V3_DIMENSIONS,
      );
      processed += 1;
      if (changes.length > 0) {
        titlesChanged += 1;
        keysChanged += changes.length;
        if (!ctx.dryRun) {
          await this.titles.update(title.id, { fingerprint: fingerprint as unknown as Title['fingerprint'] });
        }
        if (sample.length < 20) {
          sample.push({ titleId: title.id, internalId: title.internalId, changes });
        }
      }
      if (processed % PROGRESS_CHECKPOINT === 0) {
        await ctx.reportProgress({ processed, total: candidates.length, titlesChanged, keysChanged });
      }
    }
    await ctx.reportProgress({ processed, total: candidates.length, titlesChanged, keysChanged });
    return { scanned: candidates.length, processed, titlesChanged, keysChanged, sample };
  }
}
