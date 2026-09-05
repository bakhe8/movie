import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Triad } from '../../entities/triad.entity';
import { TrainingJob } from '../../entities/training-job.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { captureException } from '../../observability/observability';
import { ModelServiceClient, ModelServiceJob } from './model-service.client';
import { TrainingJobsService } from './training-jobs.service';
import { everyNTriadsFrom, firstTriadCountFrom } from './training-thresholds';

export type TrainingState =
  | 'disabled' // MODEL_SERVICE_URL unset: automatic training cannot run
  | 'paused' // profiles.pausedAt set (PRIVACY.md §4 pause_all): nothing trains
  | 'idle' // no job on record for this profile
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unknown'; // kept for API compatibility; unreachable since ADR-100 -- see below

// Completed rounds split by what they are evidence of (ADR-99/ADR-108):
// `learning` is a set this profile had not answered before and counts
// toward every threshold; `verification` is a repeat of one it had, which
// counts toward none. Ten rounds over the same three films are therefore
// reported as one learning round and nine verification rounds, not ten.
export interface RoundCounts {
  learningRounds: number;
  verificationRounds: number;
}

export interface TrainingStatus extends RoundCounts {
  state: TrainingState;
  job: ModelServiceJob | null;
  // Alias of `learningRounds`, kept so existing readers of this field do
  // not break; it has counted learning rounds only since ADR-99.
  completedTriads: number;
  // The completed-triad count at which the next automatic training fires,
  // or null when the trigger is disabled/paused.
  nextTrainingAt: number | null;
  latestSnapshot: { modelVersion: string; trainingTriadCount: number; createdAt: Date } | null;
}

// What a screen needs in order to say *why* there is no model yet -- the
// part of TrainingStatus that has no ownership check and no snapshot lookup,
// for a caller (the recommendations route) that already resolved both. The
// live round of 2026-09-05 saw ten completed rounds and "still learning your
// taste" with no reason: `pending` carried a rounds-to-go count of 0 and
// nothing else.
export interface TrainingSummary extends RoundCounts {
  state: TrainingState;
  jobId: string | null;
  errorKind: ModelServiceJob['errorKind'];
  // Alias of `learningRounds`; see TrainingStatus.
  completedTriads: number;
  nextTrainingAt: number | null;
}

export interface TrainingRequestResult {
  jobId: string;
  status: ModelServiceJob['status'];
  // false when an identical request was already waiting (idempotent).
  created: boolean;
}

// Blueprint §12.2 and §18.1's first line ("a new user reaches a first result
// without human help"): the backend asks the model service (ADR-25) to fit a
// profile after its third completed triad and every N after that, so the
// first result appears on its own after the "three to five rounds" of §5.1.
// Both thresholds are configuration (App. C leaves the exact count open).
//
// Since ADR-100 (remediation brief P0-02), every job-lifecycle question
// (queued/running/succeeded/failed, retries, idempotency) is answered by
// TrainingJobsService's durable `training_jobs` row, never by a live call
// to the model service on this class's own account: a status poll is a DB
// read, so a model-service blip costs the queue's next sweep tick, never
// this request. `state: 'unknown'` -- "the model service did not answer
// just now" -- is therefore unreachable in practice: that is exactly what
// the durable queue's backoff now absorbs instead.
@Injectable()
export class TrainingService {
  private readonly logger = new Logger(TrainingService.name);
  readonly firstTriadCount: number;
  readonly everyNTriads: number;

  constructor(
    @InjectRepository(Profile)
    private readonly profilesRepository: Repository<Profile>,
    @InjectRepository(Triad)
    private readonly triadsRepository: Repository<Triad>,
    @InjectRepository(UserModelSnapshot)
    private readonly snapshotsRepository: Repository<UserModelSnapshot>,
    private readonly client: ModelServiceClient,
    private readonly jobs: TrainingJobsService,
    config: ConfigService,
  ) {
    this.firstTriadCount = firstTriadCountFrom(config);
    this.everyNTriads = everyNTriadsFrom(config);
  }

  // True exactly at the counts 3, 3+N, 3+2N, ... (with the defaults).
  shouldTrainAt(completedTriads: number): boolean {
    if (completedTriads < this.firstTriadCount) {
      return false;
    }
    return (completedTriads - this.firstTriadCount) % this.everyNTriads === 0;
  }

  nextTrainingAt(completedTriads: number): number {
    if (completedTriads < this.firstTriadCount) {
      return this.firstTriadCount;
    }
    const sinceFirst = completedTriads - this.firstTriadCount;
    return this.firstTriadCount + (Math.floor(sinceFirst / this.everyNTriads) + 1) * this.everyNTriads;
  }

  // Called by TriadCompletedSubscriber after a triad turns 'completed'. Must
  // never throw or delay the ranking response: enqueue() itself never
  // throws for a model-service blip (ADR-100 absorbs that into the queue's
  // backoff), so this try/catch is only for a genuine DB failure.
  async onTriadCompleted(profileId: string): Promise<void> {
    if (!this.client.enabled) {
      return;
    }
    try {
      const completed = await this.countCompleted(profileId);
      if (!this.shouldTrainAt(completed)) {
        return;
      }
      const profile = await this.profilesRepository.findOne({ where: { id: profileId } });
      if (!profile || profile.pausedAt) {
        return;
      }
      const { job, created } = await this.jobs.enqueue(profileId);
      if (created) {
        this.logger.log(`training requested for profile ${profileId} at ${completed} completed triads (job ${job.id})`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`automatic training skipped for profile ${profileId}: ${reason}`);
      // Swallowed so a ranking response is never delayed or failed by it --
      // but never silent: this is the path that leaves a profile eligible
      // with no job, which the reconciler then has to catch (P0-9).
      captureException(error, { profileId, stage: 'training.onTriadCompleted' });
    }
  }

  // Read-repair for derived state (ADR-114). The normal trigger is still the
  // committed ranking event above, but a profile may become eligible while
  // the service is restarting, or an old snapshot may become incompatible
  // after a fingerprint-schema deployment. A screen that observes either
  // state asks the system to repair it; the person never has to press a
  // training button. Ownership is checked because readiness/recommendation
  // routes call this with request-scoped ids. Enqueue is idempotent, and a
  // failure remains an operational signal rather than a failed page read.
  async ensureAutomaticTraining(userId: string, profileId: string): Promise<void> {
    const profile = await this.assertProfileOwnership(userId, profileId);
    if (!this.client.enabled || profile.pausedAt) {
      return;
    }
    const completed = await this.countCompleted(profileId);
    if (completed < this.firstTriadCount) {
      return;
    }
    try {
      const { job, created } = await this.jobs.enqueue(profileId);
      if (created) {
        this.logger.log(`automatic training repaired for profile ${profileId} at ${completed} completed triads (job ${job.id})`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`automatic training repair skipped for profile ${profileId}: ${reason}`);
      captureException(error, { profileId, stage: 'training.ensureAutomaticTraining' });
    }
  }

  // POST /profiles/:profileId/train is retained as a compatibility and
  // operator-recovery endpoint, not a normal product interaction (ADR-114).
  // Once past the eligibility checks it always succeeds: a model-service blip
  // is the queue's to retry, never something a user-facing screen must fix.
  async requestTraining(userId: string, profileId: string): Promise<TrainingRequestResult> {
    const profile = await this.assertProfileOwnership(userId, profileId);
    if (!this.client.enabled) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'Automatic training is not configured on this server',
        error: 'Service Unavailable',
        reason: 'model_service_disabled',
      });
    }
    if (profile.pausedAt) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Training is paused for this profile',
        error: 'Conflict',
        reason: 'paused',
      });
    }
    const completed = await this.countCompleted(profileId);
    if (completed === 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Complete at least one ranking round before training',
        error: 'Bad Request',
        reason: 'need_more_triads',
        needed: 1,
      });
    }
    const { job, created } = await this.jobs.enqueue(profileId);
    return { jobId: job.id, status: job.status, created };
  }

  // GET /profiles/:profileId/training -- what the UI polls while it shows
  // "building your profile" after the third round.
  async status(userId: string, profileId: string): Promise<TrainingStatus> {
    const profile = await this.assertProfileOwnership(userId, profileId);
    const rounds = await this.countRounds(profileId);
    const snapshot = await this.snapshotsRepository.findOne({
      where: { profileId },
      order: { createdAt: 'DESC' },
      select: { id: true, modelVersion: true, trainingTriadCount: true, createdAt: true },
    });
    const latestSnapshot = snapshot
      ? { modelVersion: snapshot.modelVersion, trainingTriadCount: snapshot.trainingTriadCount, createdAt: snapshot.createdAt }
      : null;

    const resolved = await this.resolveState(profile, rounds.learningRounds);
    return { ...resolved, ...rounds, completedTriads: rounds.learningRounds, latestSnapshot };
  }

  // The state alone, for a caller that owns the profile already. Never
  // throws: nothing here is a live network call any more.
  async summarize(profile: Pick<Profile, 'id' | 'pausedAt'>): Promise<TrainingSummary> {
    const rounds = await this.countRounds(profile.id);
    const { state, job, nextTrainingAt } = await this.resolveState(profile, rounds.learningRounds);
    return {
      state,
      jobId: job?.id ?? null,
      errorKind: job?.errorKind ?? null,
      ...rounds,
      completedTriads: rounds.learningRounds,
      nextTrainingAt,
    };
  }

  private async resolveState(
    profile: Pick<Profile, 'id' | 'pausedAt'>,
    completed: number,
  ): Promise<{ state: TrainingState; job: ModelServiceJob | null; nextTrainingAt: number | null }> {
    if (!this.client.enabled) {
      return { state: 'disabled', job: null, nextTrainingAt: null };
    }
    if (profile.pausedAt) {
      return { state: 'paused', job: null, nextTrainingAt: null };
    }
    const nextTrainingAt = this.nextTrainingAt(completed);
    const row = await this.jobs.latestForProfile(profile.id);
    if (!row) {
      return { state: 'idle', job: null, nextTrainingAt };
    }
    return { state: row.status, job: this.toModelServiceJob(row), nextTrainingAt };
  }

  // The durable row, shaped exactly like the model service's own Job
  // (model-service.client.ts) -- every existing reader (both API consumers
  // and the frontend) keeps working against `job.id`/`status`/`errorKind`/
  // `error`, now sourced from training_jobs instead of a live HTTP call.
  private toModelServiceJob(row: TrainingJob): ModelServiceJob {
    return {
      id: row.id,
      profileId: row.profileId,
      status: row.status,
      requestedAt: row.createdAt.toISOString(),
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      errorKind: row.errorKind,
      error: row.lastError,
      result: (row.result as ModelServiceJob['result']) ?? null,
    };
  }

  // Rounds that are evidence: a verify round (a set the profile already
  // answered, ADR-99) is completed but counts toward no threshold, so ten
  // rounds over the same three films never read as ten pieces of evidence.
  async countRounds(profileId: string): Promise<RoundCounts> {
    const [learningRounds, verificationRounds] = await Promise.all([
      this.triadsRepository.count({ where: { profileId, status: 'completed', countsTowardActivation: true } }),
      this.triadsRepository.count({ where: { profileId, status: 'completed', countsTowardActivation: false } }),
    ]);
    return { learningRounds, verificationRounds };
  }

  private async countCompleted(profileId: string): Promise<number> {
    return (await this.countRounds(profileId)).learningRounds;
  }

  // 404 for a profile that is not the caller's, never 403 -- the same
  // object-level rule every profile-scoped route follows (idor.e2e-spec.ts).
  private async assertProfileOwnership(userId: string, profileId: string): Promise<Profile> {
    const profile = await this.profilesRepository.findOne({ where: { id: profileId, userId } });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return profile;
  }
}
