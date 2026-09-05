import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, In, IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import { PrivacyRequest } from '../../entities/privacy-request.entity';
import { Profile } from '../../entities/profile.entity';
import { Recommendation } from '../../entities/recommendation.entity';
import { Triad } from '../../entities/triad.entity';
import { User } from '../../entities/user.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { WatchEvent } from '../../entities/watch-event.entity';
import { AuditService } from '../audit/audit.service';
import { buildExport, ExportDocument } from './export.builder';
import { captureException } from '../../observability/observability';

export interface ResetResult {
  request: PrivacyRequest;
  deleted: { triads: number; modelSnapshots: number; recommendations: number };
}

export function subjectKeyFor(userId: string): string {
  return createHash('sha256').update(userId).digest('hex');
}

const DAY_MS = 24 * 60 * 60 * 1000;

// PRIVACY.md §5 (rights), §10 (deletion flow), BP §14 /privacy/export and
// /privacy/delete, BP §18.1 "delete and export tested end to end". ALPHA_PLAN
// phase 2, item 2.1.
//
// Export is synchronous: the whole account fits in one JSON document at
// Alpha scale, so the async artifact path of API.md §2.2 (status polling,
// 7-day artifact retention) is deferred until a document is too large to
// return inline. Deletion follows §10 exactly: scheduled with a safety
// period, cancellable until then, then purged by a job; every profile is
// paused meanwhile so nothing trains or recommends for an account that is
// leaving. Reset is immediate and profile-scoped.
@Injectable()
export class PrivacyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrivacyService.name);
  readonly safetyDays: number;
  readonly sweepIntervalMs: number;
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Profile)
    private readonly profilesRepository: Repository<Profile>,
    @InjectRepository(PrivacyRequest)
    private readonly requestsRepository: Repository<PrivacyRequest>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    this.safetyDays = PrivacyService.nonNegativeInt(config.get<string>('PRIVACY_DELETE_SAFETY_DAYS'), 7);
    this.sweepIntervalMs = PrivacyService.nonNegativeInt(config.get<string>('PRIVACY_SWEEP_INTERVAL_MS'), 60_000);
  }

  private static nonNegativeInt(raw: string | undefined, fallback: number): number {
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  }

  // The purge job (§10). Disabled under test so suites drive runDue() by
  // hand; disabled with PRIVACY_SWEEP_INTERVAL_MS=0 when an external
  // scheduler owns it.
  onModuleInit(): void {
    if (this.sweepIntervalMs === 0 || this.config.get<string>('NODE_ENV') === 'test') {
      return;
    }
    this.sweepTimer = setInterval(() => {
      void this.runDue().catch((error: unknown) => {
        this.logger.error(`deletion sweep failed: ${error instanceof Error ? error.message : String(error)}`);
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

  async listRequests(userId: string): Promise<PrivacyRequest[]> {
    return this.requestsRepository.find({ where: { userId }, order: { requestedAt: 'DESC' } });
  }

  async export(userId: string, password: string, ip: string | null): Promise<ExportDocument> {
    const user = await this.reverify(userId, password, 'privacy.export', ip);
    return this.dataSource.transaction(async (manager) => {
      const request = await manager.save(
        manager.create(PrivacyRequest, {
          userId: user.id,
          subjectKey: subjectKeyFor(user.id),
          type: 'export',
          status: 'running',
          requestedAt: new Date(),
        }),
      );
      const document = await buildExport(manager, user, request.id);
      request.status = 'done';
      request.completedAt = new Date();
      request.executionLog = {
        profiles: document.profiles.length,
        triads: document.profiles.reduce((sum, profile) => sum + profile.triads.length, 0),
        delivery: 'inline',
      };
      await manager.save(request);
      await this.audit.record(
        { actorUserId: user.id, actorRole: user.role, action: 'privacy.export', resource: 'user', resourceId: user.id, status: 'ok', reason: `request ${request.id}`, ip },
        manager,
      );
      // The request list inside the document was read before this row was
      // finished; include the finished row so the export describes itself.
      document.privacyRequests = document.privacyRequests.filter((r) => r.id !== request.id).concat(request);
      return document;
    });
  }

  async requestDelete(userId: string, password: string, ip: string | null): Promise<PrivacyRequest> {
    const user = await this.reverify(userId, password, 'privacy.delete', ip);
    const pending = await this.requestsRepository.findOne({ where: { userId: user.id, type: 'delete', status: 'scheduled' } });
    if (pending) {
      return pending;
    }
    const now = new Date();
    const executeAfter = new Date(now.getTime() + this.safetyDays * DAY_MS);
    const request = await this.dataSource.transaction(async (manager) => {
      const profiles = await manager.find(Profile, { where: { userId: user.id, pausedAt: IsNull() } });
      const pausedProfileIds = profiles.map((profile) => profile.id);
      if (pausedProfileIds.length) {
        await manager.update(Profile, { id: In(pausedProfileIds) }, { pausedAt: now });
      }
      const created = await manager.save(
        manager.create(PrivacyRequest, {
          userId: user.id,
          subjectKey: subjectKeyFor(user.id),
          type: 'delete',
          status: 'scheduled',
          requestedAt: now,
          executeAfter,
          executionLog: { safetyDays: this.safetyDays, pausedProfileIds },
        }),
      );
      await this.audit.record(
        { actorUserId: user.id, actorRole: user.role, action: 'privacy.delete.scheduled', resource: 'user', resourceId: user.id, status: 'scheduled', reason: `request ${created.id}; executeAfter ${executeAfter.toISOString()}`, ip },
        manager,
      );
      return created;
    });
    if (this.safetyDays === 0) {
      return this.execute(request);
    }
    return request;
  }

  // PRIVACY.md §4's `pause_all`: training and recommendations stop, nothing
  // is deleted. Idempotent -- pausing an already-paused account reports the
  // same shape rather than erroring, so a retried tap is harmless.
  async pauseAll(userId: string, ip: string | null): Promise<{ paused: number; pausedAt: Date }> {
    const now = new Date();
    return this.dataSource.transaction(async (manager) => {
      const open = await manager.find(Profile, { where: { userId, pausedAt: IsNull() } });
      if (open.length) {
        await manager.update(Profile, { id: In(open.map((profile) => profile.id)) }, { pausedAt: now });
      }
      await this.audit.record(
        { actorUserId: userId, action: 'privacy.pause_all', resource: 'user', resourceId: userId, status: 'ok', reason: `${open.length} profile(s)`, ip },
        manager,
      );
      return { paused: open.length, pausedAt: now };
    });
  }

  // Resume only lifts a pause the user asked for: a profile paused by a
  // scheduled deletion stays paused until that request is cancelled, which
  // is what clears it (cancelDelete above).
  async resumeAll(userId: string, ip: string | null): Promise<{ resumed: number }> {
    return this.dataSource.transaction(async (manager) => {
      const scheduled = await manager.find(PrivacyRequest, { where: { userId, type: 'delete', status: 'scheduled' } });
      const heldByDeletion = new Set(scheduled.flatMap((request) => (request.executionLog?.pausedProfileIds as string[] | undefined) ?? []));
      const paused = await manager.find(Profile, { where: { userId, pausedAt: Not(IsNull()) } });
      const resumable = paused.filter((profile) => !heldByDeletion.has(profile.id)).map((profile) => profile.id);
      if (resumable.length) {
        await manager.update(Profile, { id: In(resumable) }, { pausedAt: null });
      }
      await this.audit.record(
        { actorUserId: userId, action: 'privacy.resume', resource: 'user', resourceId: userId, status: 'ok', reason: `${resumable.length} profile(s)`, ip },
        manager,
      );
      return { resumed: resumable.length };
    });
  }

  async cancelDelete(userId: string, requestId: string, ip: string | null): Promise<PrivacyRequest> {
    const request = await this.requestsRepository.findOne({ where: { id: requestId, userId, type: 'delete' } });
    if (!request) {
      throw new NotFoundException('Privacy request not found');
    }
    if (request.status !== 'scheduled') {
      throw new ConflictException({
        statusCode: 409,
        message: 'Only a scheduled deletion can be cancelled',
        error: 'Conflict',
        reason: 'not_cancellable',
        status: request.status,
      });
    }
    return this.dataSource.transaction(async (manager) => {
      const pausedProfileIds = (request.executionLog?.pausedProfileIds as string[] | undefined) ?? [];
      if (pausedProfileIds.length) {
        await manager.update(Profile, { id: In(pausedProfileIds), userId }, { pausedAt: null });
      }
      request.status = 'cancelled';
      request.completedAt = new Date();
      request.executionLog = { ...(request.executionLog ?? {}), cancelledAt: request.completedAt.toISOString() };
      const saved = await manager.save(request);
      await this.audit.record(
        { actorUserId: userId, action: 'privacy.delete.cancelled', resource: 'user', resourceId: userId, status: 'cancelled', reason: `request ${request.id}`, ip },
        manager,
      );
      return saved;
    });
  }

  // "Reset taste" (PRIVACY.md §5): triads and their replacements, model
  // snapshots, recommendations and their outcomes -- the learned taste and
  // everything derived from it. Kept: the account, consents, the watch
  // history (title states, watch events) and other profiles.
  async reset(userId: string, profileId: string, ip: string | null): Promise<ResetResult> {
    const profile = await this.profilesRepository.findOne({ where: { id: profileId, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return this.dataSource.transaction(async (manager) => {
      const deleted = {
        // recommendations first: outcomes cascade from them and may also
        // reference a triad (ranked_later) that goes next.
        recommendations: await this.deleteWhere(manager, Recommendation, { profileId }),
        triads: await this.deleteWhere(manager, Triad, { profileId }),
        modelSnapshots: await this.deleteWhere(manager, UserModelSnapshot, { profileId }),
      };
      const request = await manager.save(
        manager.create(PrivacyRequest, {
          userId,
          subjectKey: subjectKeyFor(userId),
          profileId,
          type: 'reset',
          status: 'done',
          requestedAt: new Date(),
          completedAt: new Date(),
          executionLog: { deleted },
        }),
      );
      await this.audit.record(
        { actorUserId: userId, action: 'privacy.reset', resource: 'profile', resourceId: profileId, status: 'ok', reason: `request ${request.id}`, ip },
        manager,
      );
      return { request, deleted };
    });
  }

  // Executes every scheduled deletion whose safety period has passed.
  // Returns how many were purged. Safe to call concurrently with itself:
  // a second sweep while one runs is a no-op.
  async runDue(now: Date = new Date()): Promise<number> {
    if (this.sweeping) {
      return 0;
    }
    this.sweeping = true;
    try {
      const due = await this.requestsRepository.find({
        where: { type: 'delete', status: 'scheduled', executeAfter: LessThanOrEqual(now) },
        order: { executeAfter: 'ASC' },
      });
      let purged = 0;
      for (const request of due) {
        try {
          await this.execute(request);
          purged += 1;
        } catch (error) {
          this.logger.error(`deletion ${request.id} failed: ${error instanceof Error ? error.message : String(error)}`);
          captureException(error, { privacyRequestId: request.id });
        }
      }
      return purged;
    } finally {
      this.sweeping = false;
    }
  }

  // §10's purge: users → profiles cascade → every profile-scoped table
  // (title states, triads and replacements, snapshots, recommendations and
  // outcomes, watch events, imports, experiment assignments) and consents
  // cascade with the user; this request row survives with userId nulled by
  // its FK, plus a bare-uuid audit row. Counts are taken before the delete
  // so the execution log says what was removed.
  private async execute(request: PrivacyRequest): Promise<PrivacyRequest> {
    return this.dataSource.transaction(async (manager) => {
      const fresh = await manager.findOne(PrivacyRequest, { where: { id: request.id } });
      if (!fresh || fresh.status !== 'scheduled' || !fresh.userId) {
        return fresh ?? request;
      }
      fresh.status = 'running';
      await manager.save(fresh);

      const userId = fresh.userId;
      const profiles = await manager.find(Profile, { where: { userId }, select: { id: true } });
      const profileIds = profiles.map((profile) => profile.id);
      const counts = {
        profiles: profileIds.length,
        titleStates: profileIds.length ? await manager.count(UserTitleState, { where: { profileId: In(profileIds) } }) : 0,
        triads: profileIds.length ? await manager.count(Triad, { where: { profileId: In(profileIds) } }) : 0,
        modelSnapshots: profileIds.length ? await manager.count(UserModelSnapshot, { where: { profileId: In(profileIds) } }) : 0,
        recommendations: profileIds.length ? await manager.count(Recommendation, { where: { profileId: In(profileIds) } }) : 0,
        watchEvents: profileIds.length ? await manager.count(WatchEvent, { where: { profileId: In(profileIds) } }) : 0,
      };

      await manager.delete(User, { id: userId });

      fresh.userId = null;
      fresh.status = 'done';
      fresh.completedAt = new Date();
      fresh.executionLog = { ...(fresh.executionLog ?? {}), purged: counts, executedAt: fresh.completedAt.toISOString() };
      const saved = await manager.save(fresh);
      await this.audit.record(
        { actorUserId: null, actorRole: 'system', action: 'privacy.delete.executed', resource: 'user', resourceId: userId, status: 'ok', reason: `request ${fresh.id}` },
        manager,
      );
      this.logger.log(`account purged for request ${fresh.id}`);
      return saved;
    });
  }

  private async deleteWhere(manager: EntityManager, entity: typeof Recommendation | typeof Triad | typeof UserModelSnapshot, where: { profileId: string }): Promise<number> {
    const result = await manager.delete(entity, where);
    return result.affected ?? 0;
  }

  // PRIVACY.md §5: identity re-verification before delivery/scheduling. A
  // wrong password is audited as a failed attempt on the resource -- the
  // signal an account-takeover investigation needs (BP §21.3).
  private async reverify(userId: string, password: string, action: string, ip: string | null): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || !user.active) {
      throw new NotFoundException('Account not found');
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      await this.audit.record({ actorUserId: user.id, actorRole: user.role, action, resource: 'user', resourceId: user.id, status: 'failed', reason: 'reverification_failed', ip });
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Password re-verification failed',
        error: 'Forbidden',
        reason: 'reverification_failed',
      });
    }
    return user;
  }
}
