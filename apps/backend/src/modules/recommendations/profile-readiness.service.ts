import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserTitleState } from '../../entities/user-title-state.entity';
import { TrainingService, TrainingStatus } from '../training/training.service';
import { ConfidenceBand, RecommendationsService } from './recommendations.service';

// BP §5.1 / remediation brief §5: four capabilities that a single
// "trained or not" flag used to conflate. `not_ready` before anything has
// been asked for; `eligible` when the profile qualifies but nothing has
// been requested yet; the rest mirrors a job's own lifecycle.
export type ReadinessStatus = 'not_ready' | 'eligible' | 'queued' | 'processing' | 'ready' | 'failed' | 'stale';

// Stable codes, not prose -- the frontend supplies the copy (matching every
// other structured `reason` this API already returns, e.g. `need_more_triads`).
export type ReadinessReason =
  | 'model_service_disabled'
  | 'processing_paused'
  | 'insufficient_triads'
  | 'insufficient_fingerprint_coverage'
  | 'insufficient_eligible_candidates'
  | 'model_service_error'
  | 'fingerprint_schema_changed'
  | 'no_availability_data_source'
  | null;

// Only genuine choices the person can make belong here. Training, retries,
// schema refreshes and catalog expansion are system/operator work (ADR-114).
export type ReadinessAction = 'mark_watched_titles' | 'rank_more_triads' | 'resume_processing' | null;

export interface CapabilityReadiness {
  status: ReadinessStatus;
  reason: ReadinessReason;
  // What the brief calls "what is required from the user, if anything" --
  // null when the state needs no user action (queued/processing/ready, or a
  // failure only the operator or a later catalog update can resolve).
  action: ReadinessAction;
  publishedAt: string | null;
  modelVersion: string | null;
  // The model's own confidence band (ADR-110), from the snapshot alone --
  // null for a capability with no usable model, and for `availability`,
  // which has no model at all. A recommendation's own band can be lower
  // than this one: it is demoted per title by that title's fingerprint
  // coverage, which is a property of the title, not of the model.
  confidenceBand: ConfidenceBand | null;
}

// How many watched films keep the rounds *learning* rather than repeating.
// Three is the floor a triad needs and stays the promise on the first
// screen; three films make exactly one distinct set, so every round after
// the first is a repeat. Nine make 84, which is more rounds than the first
// result needs -- so the screens ask, progressively, for seven to nine
// (ADR-108). Not configuration: it is a property of C(n,3), not a tuning knob.
export const SUGGESTED_WATCHED_TITLES = 9;

// The counts every screen needs in order to say where the profile stands
// without keeping its own tally (ADR-108): the honest split of completed
// rounds, the thresholds they are measured against, and the watched set
// those rounds are drawn from.
export interface ReadinessRounds {
  learningRounds: number;
  verificationRounds: number;
  // The learning-round count at which the first training run fires, and
  // the next one after that (null when training is disabled or paused).
  firstTrainingAt: number;
  nextTrainingAt: number | null;
  // Watched titles this profile has that a triad may draw (`triadEligible`).
  watchedTitles: number;
  suggestedWatchedTitles: number;
}

export interface ProfileReadiness {
  rounds: ReadinessRounds;
  // Ranking of the profile's own watched titles (Plackett-Luce fit).
  ordinalModel: CapabilityReadiness;
  // Tendencies across narrative/pacing/tone axes with confidence. Today
  // this is the *same* fit as ordinalModel -- one trainer run produces
  // both the ranking and the weight vector "profile" in this codebase's
  // architecture. Kept as its own field because the brief treats them as
  // distinct capabilities with different data requirements (a semantic
  // profile needs fingerprint coverage a bare ranking does not); giving
  // them independent values honestly needs the trainer to report per-
  // triad fingerprint coverage, which it does not yet (see ADR-103).
  semanticProfile: CapabilityReadiness;
  // Personal Fit for titles the profile has not watched -- needs a ready
  // model *and* a non-empty candidate pool; either alone is not enough.
  recommendation: CapabilityReadiness;
  // Watchability in the profile's market/platforms. Always `not_ready`
  // today (remediation brief AVL-01): no availability data source is wired
  // yet. The shape exists so a real source can fill it in without another
  // contract change.
  availability: CapabilityReadiness;
}

const NOT_BUILT_AVAILABILITY: CapabilityReadiness = {
  status: 'not_ready',
  reason: 'no_availability_data_source',
  action: null,
  publishedAt: null,
  modelVersion: null,
  confidenceBand: null,
};

@Injectable()
export class ProfileReadinessService {
  constructor(
    private readonly trainingService: TrainingService,
    private readonly recommendationsService: RecommendationsService,
    @InjectRepository(UserTitleState)
    private readonly statesRepository: Repository<UserTitleState>,
  ) {}

  async forProfile(userId: string, profileId: string): Promise<ProfileReadiness> {
    const [snapshotState, initialTraining, watchedTitles, confidenceBand] = await Promise.all([
      this.recommendationsService.snapshotState(userId, profileId),
      // Ownership is checked here (404 for someone else's profile) before
      // the watched count below is read.
      this.trainingService.status(userId, profileId),
      this.eligibleWatchedCount(profileId),
      this.recommendationsService.modelConfidence(userId, profileId),
    ]);
    let training = initialTraining;
    const needsReadRepair =
      snapshotState === 'model_outdated' ||
      (snapshotState === 'pending' && training.state === 'idle' && training.completedTriads >= this.trainingService.firstTriadCount);
    if (needsReadRepair) {
      await this.trainingService.ensureAutomaticTraining(userId, profileId);
      training = await this.trainingService.status(userId, profileId);
    }
    const model = this.modelCapability(snapshotState, training, confidenceBand, watchedTitles);
    const recommendation = await this.recommendationCapability(model, profileId);
    return {
      rounds: {
        learningRounds: training.learningRounds,
        verificationRounds: training.verificationRounds,
        firstTrainingAt: this.trainingService.firstTriadCount,
        nextTrainingAt: training.nextTrainingAt,
        watchedTitles,
        suggestedWatchedTitles: SUGGESTED_WATCHED_TITLES,
      },
      ordinalModel: model,
      semanticProfile: model,
      recommendation,
      availability: NOT_BUILT_AVAILABILITY,
    };
  }

  // The same set TriadsService draws from: watched, and not excluded from
  // triads by a "haven't watched"/"don't remember" swap.
  private async eligibleWatchedCount(profileId: string): Promise<number> {
    return this.statesRepository.count({ where: { profileId, state: 'watched', triadEligible: true } });
  }

  private modelCapability(
    snapshotState: 'ready' | 'pending' | 'paused' | 'model_outdated',
    training: TrainingStatus,
    confidenceBand: ConfidenceBand | null,
    watchedTitles: number,
  ): CapabilityReadiness {
    const published = training.latestSnapshot
      ? {
          publishedAt: training.latestSnapshot.createdAt.toISOString(),
          modelVersion: training.latestSnapshot.modelVersion,
          confidenceBand,
        }
      : { publishedAt: null, modelVersion: null, confidenceBand };

    if (snapshotState === 'ready') {
      return { status: 'ready', reason: null, action: null, ...published };
    }
    // A snapshot exists but no longer matches the current fingerprint schema.
    // Readiness has already scheduled its replacement above: a deployment is
    // never converted into homework for the person whose choices are saved.
    if (snapshotState === 'model_outdated') {
      if (training.state === 'queued' || training.state === 'running') {
        return {
          status: training.state === 'queued' ? 'queued' : 'processing',
          reason: 'fingerprint_schema_changed',
          action: null,
          publishedAt: null,
          modelVersion: null,
          confidenceBand: null,
        };
      }
      if (training.state === 'disabled') {
        return { status: 'not_ready', reason: 'model_service_disabled', action: null, publishedAt: null, modelVersion: null, confidenceBand: null };
      }
      if (training.state === 'failed') {
        return {
          status: 'failed',
          reason: training.job?.errorKind === 'invalid' ? 'insufficient_fingerprint_coverage' : 'model_service_error',
          action: null,
          publishedAt: null,
          modelVersion: null,
          confidenceBand: null,
        };
      }
      return { status: 'stale', reason: 'fingerprint_schema_changed', action: null, publishedAt: null, modelVersion: null, confidenceBand: null };
    }
    if (snapshotState === 'paused') {
      return { status: 'not_ready', reason: 'processing_paused', action: 'resume_processing', publishedAt: null, modelVersion: null, confidenceBand: null };
    }
    // snapshotState === 'pending': no usable snapshot yet. training.state
    // carries the finer distinction of *why*.
    switch (training.state) {
      case 'disabled':
        return { status: 'not_ready', reason: 'model_service_disabled', action: null, ...published };
      case 'queued':
        return { status: 'queued', reason: null, action: null, ...published };
      case 'running':
        return { status: 'processing', reason: null, action: null, ...published };
      case 'failed':
        return training.job?.errorKind === 'invalid'
          ? { status: 'failed', reason: 'insufficient_fingerprint_coverage', action: null, ...published }
          : { status: 'failed', reason: 'model_service_error', action: null, ...published };
      case 'idle':
      default:
        return training.completedTriads < this.trainingService.firstTriadCount
          ? {
              status: 'not_ready',
              reason: 'insufficient_triads',
              action: watchedTitles < 3 ? 'mark_watched_titles' : 'rank_more_triads',
              ...published,
            }
          : { status: 'eligible', reason: null, action: null, ...published };
    }
  }

  private async recommendationCapability(model: CapabilityReadiness, profileId: string): Promise<CapabilityReadiness> {
    if (model.status !== 'ready') {
      // Cannot recommend for unwatched titles without a usable model --
      // the same situation, not a second, unrelated failure.
      return model;
    }
    const candidates = await this.recommendationsService.candidatePoolSize(profileId);
    return candidates > 0
      ? {
          status: 'ready',
          reason: null,
          action: null,
          publishedAt: model.publishedAt,
          modelVersion: model.modelVersion,
          confidenceBand: model.confidenceBand,
        }
      : {
          status: 'not_ready',
          reason: 'insufficient_eligible_candidates',
          action: null,
          publishedAt: model.publishedAt,
          modelVersion: model.modelVersion,
          confidenceBand: model.confidenceBand,
        };
  }
}
