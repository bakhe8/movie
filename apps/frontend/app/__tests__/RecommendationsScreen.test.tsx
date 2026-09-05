import '../../jest-dom-vitest';
/**
 * RecommendationsScreen — the pending state says what became of the rounds
 * (brief P0-01/P0-03, live round 2026-09-05: ten rounds, "still learning
 * your taste", no reason, no button).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecommendationsScreen } from '../components/RecommendationsScreen';

vi.mock('../lib/api', () => ({
  api: {
    getRecommendations: vi.fn(),
    getWatchedTitles: vi.fn().mockResolvedValue([]),
    getReadiness: vi.fn(),
    requestTraining: vi.fn(),
    setTitleState: vi.fn(),
    // The ready screen reports what it showed and what was clicked (ADR-110);
    // both are fire-and-forget, so the mock only has to exist.
    recordImpressions: vi.fn().mockResolvedValue(undefined),
    recordOutcome: vi.fn().mockResolvedValue(undefined),
  },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public details: Record<string, unknown> = {},
    ) {
      super(message);
    }
  },
}));

import { api, ApiError } from '../lib/api';
const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function pending(needed: number, training: Partial<{ state: string; jobId: string | null; errorKind: string | null }> = {}) {
  return {
    state: 'pending',
    needed,
    training: { state: 'idle', jobId: null, errorKind: null, completedTriads: 10, nextTrainingAt: 13, ...training },
  };
}

// Readiness explains a pending screen (ADR-103); rejecting by default keeps
// every existing case on the training-state fallback it was written for, so
// the tests below still cover that path.
const capability = (over: Record<string, unknown> = {}) => ({ status: 'not_ready', reason: null, action: null, publishedAt: null, modelVersion: null, ...over });
const readiness = (recommendation: Record<string, unknown>) => ({
  ordinalModel: capability(),
  semanticProfile: capability(),
  recommendation: capability(recommendation),
  availability: capability({ reason: 'no_availability_data_source' }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getWatchedTitles.mockResolvedValue([]);
  mockApi.getReadiness.mockRejectedValue(new Error('not mocked in this case'));
  mockApi.recordImpressions.mockResolvedValue(undefined);
  mockApi.recordOutcome.mockResolvedValue(undefined);
});

// UX_AUDIT_MOBILE_2026-09-05 P0 #1, #4 and #15: the ready screen was 6065px
// of stacked cards under a paragraph explaining the four values, with the
// confidence sentence repeated on all thirteen. ADR-111 turns the tracks into
// shelves of tiles and says what the model learned once, at the top.
const title = (id: string, ar: string) => ({
  id,
  internalId: `i-${id}`,
  titleEn: 'Divine Intervention',
  titleAr: ar,
  description: null,
  releaseYear: 2002,
  genres: null,
  posterUrl: null,
});

const item = (id: string, ar: string, track: string) => ({
  recommendationId: `r-${id}`,
  title: title(id, ar),
  personalFitScore: 0.9,
  publicQualityScore: 6.6,
  watchabilityScore: null,
  availability: 'unknown',
  confidenceBand: 'inconclusive',
  fingerprintCoverage: 1,
  track,
  modelVersion: 'test-v1',
  reason: { features: [{ key: 'ambiguity', direction: 'higher' }], evidenceSource: 'individual' },
});

const readyReadiness = {
  rounds: { learningRounds: 3, verificationRounds: 0, firstTrainingAt: 3, nextTrainingAt: null, watchedTitles: 7, suggestedWatchedTitles: 9 },
  ordinalModel: capability({ status: 'ready' }),
  semanticProfile: capability({ status: 'ready' }),
  recommendation: capability({ status: 'ready', confidenceBand: 'initial' }),
  availability: capability({ reason: 'no_availability_data_source' }),
};

describe('RecommendationsScreen — ready', () => {
  beforeEach(() => {
    mockApi.getRecommendations.mockResolvedValue({
      state: 'ready',
      items: [item('a', 'يد إلهية', 'safe'), item('b', 'لا بلد للعجائز', 'safe'), item('c', 'اشتباك', 'discovery')],
    });
    mockApi.getReadiness.mockResolvedValue(readyReadiness);
  });

  it('says what the model learned once, instead of explaining the four values', async () => {
    const { container } = render(<RecommendationsScreen lang="ar" profileId="p1" />);
    await screen.findByLabelText('ذوقك حتى الآن');

    // The paragraph that described the values is gone; the values show themselves.
    expect(screen.queryByText(/لكل فيلم أربع قيم منفصلة/)).toBeNull();
    // The counts come from the readiness contract, not from this screen.
    await waitFor(() => expect(screen.getByText('جولات رتّبتها')).toBeInTheDocument());
    expect(screen.getByText('أفلام شاهدتها')).toBeInTheDocument();
    // The band is stated once for the whole screen.
    expect(container.querySelectorAll('[class*="confidenceOnce"]')).toHaveLength(1);
  });

  it('leans on the traits the items agree on', async () => {
    render(<RecommendationsScreen lang="ar" profileId="p1" />);

    await waitFor(() => expect(screen.getByText('غموض مقصود')).toBeInTheDocument());
  });

  it('shows each track as a shelf, and gives the full cards back when it is opened', async () => {
    const user = userEvent.setup();
    const { container } = render(<RecommendationsScreen lang="ar" profileId="p1" />);
    await screen.findByLabelText('ذوقك حتى الآن');

    // A shelf carries tiles: no action buttons and no reason line on them.
    expect(container.querySelectorAll('[class*="rail"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'أضف إلى قائمتي' })).toBeNull();

    // Every track opens, not only the ones with items left over: the tiles
    // carry no actions, so the way in must always be there.
    await user.click(screen.getAllByRole('button', { name: 'افتح المسار' })[0]);

    expect(container.querySelectorAll('[class*="rail"]').length).toBeLessThan(3);
    expect(screen.getAllByRole('button', { name: 'أضف إلى قائمتي' }).length).toBeGreaterThan(0);
  });
});

describe('RecommendationsScreen — pending', () => {
  it('still counts rounds while more are needed', async () => {
    mockApi.getRecommendations.mockResolvedValue(pending(2));
    render(<RecommendationsScreen lang="ar" profileId="p1" />);
    await screen.findByText(/ما زلنا نتعلم ذوقك/);
  });

  it('offers to train now when the rounds are enough and nothing was ever requested, then shows the build', async () => {
    const user = userEvent.setup();
    mockApi.getRecommendations.mockResolvedValueOnce(pending(0, { state: 'idle' })).mockResolvedValueOnce(pending(0, { state: 'queued', jobId: 'job-1' }));
    mockApi.requestTraining.mockResolvedValue({ jobId: 'job-1', status: 'queued', created: true });
    render(<RecommendationsScreen lang="ar" profileId="p1" />);
    await screen.findByText(/جولاتك تكفي للبدء/);
    await user.click(screen.getByRole('button', { name: /درّب نموذجي الآن/ }));
    expect(mockApi.requestTraining).toHaveBeenCalledWith('p1');
    await screen.findByText(/جارٍ بناء نموذجك/);
  });

  it('names the missing fingerprints, with the support code, when the job failed as invalid', async () => {
    mockApi.getRecommendations.mockResolvedValue(pending(0, { state: 'failed', errorKind: 'invalid', jobId: 'job-9' }));
    render(<RecommendationsScreen lang="ar" profileId="p1" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/ينتظر تحليل الأفلام/);
    expect(alert).toHaveTextContent(/job-9/);
    expect(screen.queryByText(/ما زلنا نتعلم ذوقك/)).not.toBeInTheDocument();
  });

  it('says training is not enabled on this server, and offers nothing to press', async () => {
    mockApi.getRecommendations.mockResolvedValue(pending(0, { state: 'disabled' }));
    render(<RecommendationsScreen lang="en" profileId="p1" />);
    await screen.findByText(/Training is not enabled on this server/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // The two things the readiness contract can say and a training state
  // cannot (ADR-103): a ready model with an empty pool, and a coverage
  // failure named as such rather than inferred from errorKind.
  it('says the model is ready and the pool is empty, instead of an empty list', async () => {
    mockApi.getRecommendations.mockResolvedValue({ state: 'ready', items: [] });
    mockApi.getReadiness.mockResolvedValue(readiness({ status: 'not_ready', reason: 'insufficient_eligible_candidates' }));
    render(<RecommendationsScreen lang="ar" profileId="p1" />);

    const panel = await screen.findByRole('status');
    expect(panel).toHaveTextContent(/لا أفلام جديدة نقترحها/);
    // A calm state, not a failure: nothing to press, no support code.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('prefers readiness over the training state when the two could disagree', async () => {
    // The job merely looks idle; readiness knows the coverage is the problem.
    mockApi.getRecommendations.mockResolvedValue(pending(0, { state: 'idle', jobId: 'job-4' }));
    mockApi.getReadiness.mockResolvedValue(readiness({ status: 'failed', reason: 'insufficient_fingerprint_coverage' }));
    render(<RecommendationsScreen lang="ar" profileId="p1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/ينتظر تحليل الأفلام/);
    expect(screen.queryByText(/جولاتك تكفي للبدء/)).not.toBeInTheDocument();
  });

  it('falls back to the training state when readiness cannot be read', async () => {
    mockApi.getRecommendations.mockResolvedValue(pending(0, { state: 'unknown' }));
    mockApi.getReadiness.mockRejectedValue(new Error('offline'));
    render(<RecommendationsScreen lang="ar" profileId="p1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/تعذّر الوصول إلى خدمة النموذج/);
  });

  it('shows the refusal reason when the train request is turned away', async () => {
    const user = userEvent.setup();
    mockApi.getRecommendations.mockResolvedValue(pending(0, { state: 'failed', errorKind: 'error', jobId: 'job-2' }));
    mockApi.requestTraining.mockRejectedValue(new ApiError('unavailable', 503, { reason: 'model_service_unreachable' }));
    render(<RecommendationsScreen lang="ar" profileId="p1" />);
    await user.click(await screen.findByRole('button', { name: /أعد المحاولة/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/تعذّر الوصول إلى خدمة النموذج/));
  });
});
