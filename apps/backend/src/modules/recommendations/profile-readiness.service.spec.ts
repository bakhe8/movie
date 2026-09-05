import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { UserTitleState } from '../../entities/user-title-state.entity';
import type { TrainingService, TrainingStatus } from '../training/training.service';
import type { RecommendationsService } from './recommendations.service';
import { ProfileReadinessService } from './profile-readiness.service';

function trainingStatus(overrides: Partial<TrainingStatus> = {}): TrainingStatus {
  return {
    state: 'idle',
    job: null,
    completedTriads: 0,
    learningRounds: overrides.completedTriads ?? 0,
    verificationRounds: 0,
    nextTrainingAt: 3,
    latestSnapshot: null,
    ...overrides,
  };
}

function servicesOf(overrides: {
  snapshotState?: 'ready' | 'pending' | 'paused' | 'model_outdated';
  status?: Partial<TrainingStatus>;
  statusAfterEnsure?: Partial<TrainingStatus>;
  candidatePoolSize?: number;
  firstTriadCount?: number;
  watchedTitles?: number;
  confidenceBand?: 'initial' | 'likely' | 'strong' | 'inconclusive';
}) {
  const initialStatus = trainingStatus(overrides.status);
  const statusAfterEnsure = trainingStatus(overrides.statusAfterEnsure ?? overrides.status);
  const training = {
    firstTriadCount: overrides.firstTriadCount ?? 3,
    status: vi.fn().mockResolvedValueOnce(initialStatus).mockResolvedValue(statusAfterEnsure),
    ensureAutomaticTraining: vi.fn(async () => undefined),
  };
  const recommendations = {
    snapshotState: vi.fn(async () => overrides.snapshotState ?? 'pending'),
    candidatePoolSize: vi.fn(async () => overrides.candidatePoolSize ?? 0),
    modelConfidence: vi.fn(async () => overrides.confidenceBand ?? null),
  };
  const states = { count: vi.fn(async () => overrides.watchedTitles ?? 0) };
  return {
    training: training as unknown as TrainingService,
    recommendations,
    states,
    service: new ProfileReadinessService(
      training as unknown as TrainingService,
      recommendations as unknown as RecommendationsService,
      states as unknown as Repository<UserTitleState>,
    ),
  };
}

// ADR-103 (remediation brief §5.1): four capabilities that a single
// "trained or not" flag used to conflate. Each case below is one row the
// brief's own table names as a distinct, reachable situation.
describe('ProfileReadinessService', () => {
  it('reports not_ready/insufficient_triads before enough rounds are ranked', async () => {
    const { service } = servicesOf({ snapshotState: 'pending', status: { state: 'idle', completedTriads: 1 }, firstTriadCount: 3, watchedTitles: 0 });
    const result = await service.forProfile('user-1', 'profile-1');
    expect(result.ordinalModel).toMatchObject({ status: 'not_ready', reason: 'insufficient_triads', action: 'mark_watched_titles' });
    expect(result.semanticProfile).toEqual(result.ordinalModel);
    // Cannot recommend without a model -- the same situation, not a second one.
    expect(result.recommendation).toEqual(result.ordinalModel);
  });

  it('repairs an eligible idle profile automatically and reports the queued work with no user action', async () => {
    const { service, training } = servicesOf({
      snapshotState: 'pending',
      status: { state: 'idle', completedTriads: 5 },
      statusAfterEnsure: { state: 'queued', completedTriads: 5 },
      firstTriadCount: 3,
      watchedTitles: 6,
    });
    const result = await service.forProfile('user-1', 'profile-1');
    expect(training.ensureAutomaticTraining).toHaveBeenCalledWith('user-1', 'profile-1');
    expect(result.ordinalModel).toMatchObject({ status: 'queued', reason: null, action: null });
  });

  it('reports queued and processing while the job is in flight', async () => {
    const { service: queuedService } = servicesOf({ snapshotState: 'pending', status: { state: 'queued' } });
    expect((await queuedService.forProfile('user-1', 'profile-1')).ordinalModel.status).toBe('queued');

    const { service: runningService } = servicesOf({ snapshotState: 'pending', status: { state: 'running' } });
    expect((await runningService.forProfile('user-1', 'profile-1')).ordinalModel.status).toBe('processing');
  });

  it('distinguishes a deterministic failure (no fingerprints) from a real error', async () => {
    const { service: invalid } = servicesOf({
      snapshotState: 'pending',
      status: { state: 'failed', job: { id: 'j1', profileId: 'p1', status: 'failed', requestedAt: '', startedAt: null, finishedAt: null, errorKind: 'invalid', error: 'x', result: null } },
    });
    expect((await invalid.forProfile('user-1', 'profile-1')).ordinalModel).toMatchObject({
      status: 'failed',
      reason: 'insufficient_fingerprint_coverage',
      action: null,
    });

    const { service: error } = servicesOf({
      snapshotState: 'pending',
      status: { state: 'failed', job: { id: 'j1', profileId: 'p1', status: 'failed', requestedAt: '', startedAt: null, finishedAt: null, errorKind: 'error', error: 'x', result: null } },
    });
    expect((await error.forProfile('user-1', 'profile-1')).ordinalModel).toMatchObject({
      status: 'failed',
      reason: 'model_service_error',
      action: null,
    });
  });

  it('reports not_ready/model_service_disabled and paused distinctly from a training failure', async () => {
    const { service: disabled } = servicesOf({ snapshotState: 'pending', status: { state: 'disabled' } });
    expect((await disabled.forProfile('user-1', 'profile-1')).ordinalModel).toMatchObject({
      status: 'not_ready',
      reason: 'model_service_disabled',
    });

    const { service: paused } = servicesOf({ snapshotState: 'paused' });
    expect((await paused.forProfile('user-1', 'profile-1')).ordinalModel).toMatchObject({
      status: 'not_ready',
      reason: 'processing_paused',
      action: 'resume_processing',
    });
  });

  it('schedules a stale snapshot replacement automatically instead of asking for unrelated rankings', async () => {
    const { service, training } = servicesOf({
      snapshotState: 'model_outdated',
      status: { state: 'succeeded', completedTriads: 5 },
      statusAfterEnsure: { state: 'running', completedTriads: 5 },
    });
    const result = await service.forProfile('user-1', 'profile-1');
    expect(training.ensureAutomaticTraining).toHaveBeenCalledWith('user-1', 'profile-1');
    expect(result.ordinalModel).toMatchObject({ status: 'processing', reason: 'fingerprint_schema_changed', action: null });
  });

  it('separates a ready model from an empty candidate pool -- two different reasons for no recommendations', async () => {
    const created = new Date('2026-09-04T00:00:00Z');
    const { service } = servicesOf({
      snapshotState: 'ready',
      status: { state: 'succeeded', latestSnapshot: { modelVersion: 'plackett-luce-v3', trainingTriadCount: 25, createdAt: created } },
      candidatePoolSize: 0,
    });
    const result = await service.forProfile('user-1', 'profile-1');
    expect(result.ordinalModel).toMatchObject({ status: 'ready', reason: null, modelVersion: 'plackett-luce-v3' });
    expect(result.semanticProfile).toEqual(result.ordinalModel);
    expect(result.recommendation).toMatchObject({
      status: 'not_ready',
      reason: 'insufficient_eligible_candidates',
      action: null,
      modelVersion: 'plackett-luce-v3',
    });
  });

  it('asks for a ranking only when enough watched titles make that action possible', async () => {
    const { service } = servicesOf({
      snapshotState: 'pending',
      status: { state: 'idle', completedTriads: 1 },
      watchedTitles: 3,
    });
    expect((await service.forProfile('user-1', 'profile-1')).ordinalModel.action).toBe('rank_more_triads');
  });

  it('reports every capability ready with a non-empty pool', async () => {
    const created = new Date('2026-09-04T00:00:00Z');
    const { service } = servicesOf({
      snapshotState: 'ready',
      status: { state: 'succeeded', latestSnapshot: { modelVersion: 'plackett-luce-v3', trainingTriadCount: 25, createdAt: created } },
      candidatePoolSize: 40,
    });
    const result = await service.forProfile('user-1', 'profile-1');
    expect(result.ordinalModel.status).toBe('ready');
    expect(result.recommendation).toMatchObject({ status: 'ready', reason: null, publishedAt: created.toISOString() });
  });

  // ADR-108: the screens stop keeping their own tally of rounds. The count
  // they show, the thresholds it is measured against, and the watched set
  // the rounds are drawn from all come from this one call.
  it('reports learning and verification rounds apart, with the watched set they are drawn from', async () => {
    const { service } = servicesOf({
      status: { state: 'idle', completedTriads: 4, learningRounds: 4, verificationRounds: 6, nextTrainingAt: 8 },
      firstTriadCount: 3,
      watchedTitles: 3,
    });
    const result = await service.forProfile('user-1', 'profile-1');
    // Ten completed rounds over three films: four are evidence, six are repeats.
    expect(result.rounds).toEqual({
      learningRounds: 4,
      verificationRounds: 6,
      firstTrainingAt: 3,
      nextTrainingAt: 8,
      watchedTitles: 3,
      suggestedWatchedTitles: 9,
    });
  });

  // AVL-01: no availability data source exists yet -- reported honestly,
  // never a fabricated "ready".
  it('always reports availability as not_ready, with the reason named', async () => {
    const { service } = servicesOf({ snapshotState: 'ready', candidatePoolSize: 5 });
    const result = await service.forProfile('user-1', 'profile-1');
    expect(result.availability).toEqual({
      status: 'not_ready',
      reason: 'no_availability_data_source',
      action: null,
      publishedAt: null,
      modelVersion: null,
      confidenceBand: null,
    });
  });

  // ADR-110: the profile screen used to request one recommendation purely to
  // read a confidence band -- writing a row and stamping it shown for a list
  // nobody ever saw. The band belongs to the model, so readiness carries it.
  it('carries the model confidence band, so no screen requests a recommendation to read one', async () => {
    const created = new Date('2026-09-04T00:00:00Z');
    const { service, recommendations } = servicesOf({
      snapshotState: 'ready',
      status: { state: 'succeeded', latestSnapshot: { modelVersion: 'plackett-luce-v3', trainingTriadCount: 25, createdAt: created } },
      candidatePoolSize: 12,
      confidenceBand: 'likely',
    });
    const result = await service.forProfile('user-1', 'profile-1');
    expect(result.ordinalModel.confidenceBand).toBe('likely');
    expect(result.recommendation.confidenceBand).toBe('likely');
    expect(result.availability.confidenceBand).toBeNull();
    expect(recommendations.candidatePoolSize).toHaveBeenCalled();
  });
});
