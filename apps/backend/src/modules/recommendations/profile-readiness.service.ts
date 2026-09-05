import { Injectable } from '@nestjs/common';
import { TrainingService, TrainingStatus } from '../training/training.service';
import { RecommendationsService } from './recommendations.service';

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

export type ReadinessAction = 'rank_more_triads' | 'watch_more_titles' | 'request_training' | 'resume_processing' | 'retry' | null;

export interface CapabilityReadiness {
  status: ReadinessStatus;
  reason: ReadinessReason;
  // What the brief calls "what is required from the user, if anything" --
  // null when the state needs no user action (queued/processing/ready, or a
  // failure only the operator or a later catalog update can resolve).
  action: ReadinessAction;
  publishedAt: string | null;
  modelVersion: string | null;
}

export interface ProfileReadiness {
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
};

@Injectable()
export class ProfileReadinessService {
  constructor(
    private readonly trainingService: TrainingService,
    private readonly recommendationsService: RecommendationsService,
  ) {}

  async forProfile(userId: string, profileId: string): Promise<ProfileReadiness> {
    const [snapshotState, training] = await Promise.all([
      this.recommendationsService.snapshotState(userId, profileId),
      this.trainingService.status(userId, profileId),
    ]);
    const model = this.modelCapability(snapshotState, training);
    const recommendation = await this.recommendationCapability(model, profileId);
    return { ordinalModel: model, semanticProfile: model, recommendation, availability: NOT_BUILT_AVAILABILITY };
  }

  private modelCapability(
    snapshotState: 'ready' | 'pending' | 'paused' | 'model_outdated',
    training: TrainingStatus,
  ): CapabilityReadiness {
    const published = training.latestSnapshot
      ? { publishedAt: training.latestSnapshot.createdAt.toISOString(), modelVersion: training.latestSnapshot.modelVersion }
      : { publishedAt: null, modelVersion: null };

    if (snapshotState === 'ready') {
      return { status: 'ready', reason: null, action: null, ...published };
    }
    // A snapshot exists but no longer matches the current fingerprint
    // schema (ADR-69/75 dimension changes) -- the next training run
    // replaces it; ranking a few more triads is what actually triggers one.
    if (snapshotState === 'model_outdated') {
      return { status: 'stale', reason: 'fingerprint_schema_changed', action: 'rank_more_triads', ...published };
    }
    if (snapshotState === 'paused') {
      return { status: 'not_ready', reason: 'processing_paused', action: 'resume_processing', publishedAt: null, modelVersion: null };
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
          : { status: 'failed', reason: 'model_service_error', action: 'retry', ...published };
      case 'idle':
      default:
        return training.completedTriads < this.trainingService.firstTriadCount
          ? { status: 'not_ready', reason: 'insufficient_triads', action: 'rank_more_triads', ...published }
          : { status: 'eligible', reason: null, action: 'request_training', ...published };
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
      ? { status: 'ready', reason: null, action: null, publishedAt: model.publishedAt, modelVersion: model.modelVersion }
      : {
          status: 'not_ready',
          reason: 'insufficient_eligible_candidates',
          action: 'watch_more_titles',
          publishedAt: model.publishedAt,
          modelVersion: model.modelVersion,
        };
  }
}
