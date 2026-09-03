import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../../entities/profile.entity';
import { Triad } from '../../entities/triad.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { ModelServiceClient, ModelServiceError, ModelServiceJob } from './model-service.client';

export type TrainingState =
  | 'disabled' // MODEL_SERVICE_URL unset: training is the manual CLI only
  | 'paused' // profiles.pausedAt set (PRIVACY.md §4 pause_all): nothing trains
  | 'idle' // no job on record for this profile
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unknown'; // the model service did not answer

export interface TrainingStatus {
  state: TrainingState;
  job: ModelServiceJob | null;
  completedTriads: number;
  // The completed-triad count at which the next automatic training fires,
  // or null when the trigger is disabled/paused.
  nextTrainingAt: number | null;
  latestSnapshot: { modelVersion: string; trainingTriadCount: number; createdAt: Date } | null;
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
    config: ConfigService,
  ) {
    this.firstTriadCount = TrainingService.positiveInt(config.get<string>('TRAINING_FIRST_TRIAD_COUNT'), 3);
    this.everyNTriads = TrainingService.positiveInt(config.get<string>('TRAINING_EVERY_N_TRIADS'), 5);
  }

  private static positiveInt(raw: string | undefined, fallback: number): number {
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : fallback;
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
  // never throw or delay the ranking response: a model service that is down
  // costs a log line and the next threshold, not a failed rank.
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
      const job = await this.client.requestTraining(profileId);
      this.logger.log(`training requested for profile ${profileId} at ${completed} completed triads (job ${job.id})`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`automatic training skipped for profile ${profileId}: ${reason}`);
    }
  }

  // POST /profiles/:profileId/train -- the owner asks explicitly (the
  // profile screen's "update my model", and the e2e path).
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
    const before = await this.safeLatestJob(profileId);
    try {
      const job = await this.client.requestTraining(profileId);
      return { jobId: job.id, status: job.status, created: before?.id !== job.id };
    } catch (error) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'The model service did not accept the request',
        error: 'Service Unavailable',
        reason: 'model_service_unreachable',
        detail: error instanceof ModelServiceError ? error.message : undefined,
      });
    }
  }

  // GET /profiles/:profileId/training -- what the UI polls while it shows
  // "building your profile" after the third round.
  async status(userId: string, profileId: string): Promise<TrainingStatus> {
    const profile = await this.assertProfileOwnership(userId, profileId);
    const completed = await this.countCompleted(profileId);
    const snapshot = await this.snapshotsRepository.findOne({
      where: { profileId },
      order: { createdAt: 'DESC' },
      select: { id: true, modelVersion: true, trainingTriadCount: true, createdAt: true },
    });
    const latestSnapshot = snapshot
      ? { modelVersion: snapshot.modelVersion, trainingTriadCount: snapshot.trainingTriadCount, createdAt: snapshot.createdAt }
      : null;

    if (!this.client.enabled) {
      return { state: 'disabled', job: null, completedTriads: completed, nextTrainingAt: null, latestSnapshot };
    }
    if (profile.pausedAt) {
      return { state: 'paused', job: null, completedTriads: completed, nextTrainingAt: null, latestSnapshot };
    }
    const nextTrainingAt = this.nextTrainingAt(completed);
    let job: ModelServiceJob | null;
    try {
      job = await this.client.getLatestJob(profileId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`training status unavailable for profile ${profileId}: ${reason}`);
      return { state: 'unknown', job: null, completedTriads: completed, nextTrainingAt, latestSnapshot };
    }
    return { state: job ? job.status : 'idle', job, completedTriads: completed, nextTrainingAt, latestSnapshot };
  }

  private async countCompleted(profileId: string): Promise<number> {
    return this.triadsRepository.count({ where: { profileId, status: 'completed' } });
  }

  private async safeLatestJob(profileId: string): Promise<ModelServiceJob | null> {
    try {
      return await this.client.getLatestJob(profileId);
    } catch {
      return null;
    }
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
