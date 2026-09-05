import '../../jest-dom-vitest';
/**
 * RecommendationsScreen — the pending state says what became of the rounds
 * (brief P0-01/P0-03, live round 2026-09-05: ten rounds, "still learning
 * your taste", no reason, no button).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecommendationsScreen } from '../components/RecommendationsScreen';

vi.mock('../lib/api', () => ({
  api: {
    getRecommendations: vi.fn(),
    getWatchedTitles: vi.fn().mockResolvedValue([]),
    getWatchlist: vi.fn().mockResolvedValue([]),
    getReadiness: vi.fn(),
    requestTraining: vi.fn(),
    setTitleState: vi.fn(),
    recordWatchEvent: vi.fn(),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

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
  mockApi.getWatchlist.mockResolvedValue([]);
  mockApi.setTitleState.mockResolvedValue({});
  mockApi.recordWatchEvent.mockResolvedValue({});
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
  // Use the production contract here, not only the transitional score: the
  // shelf must not accidentally grow a full IMDb cell again.
  publicQuality: {
    value: 6.6,
    votes: 4239,
    sources: [{ source: 'imdb', value: 6.6, scale: '1-10', votes: 4239, capturedAt: '2026-09-05T00:00:00.000Z', attribution: null }],
  },
  watchabilityScore: null,
  watchability: { available: null, providers: [] },
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

  // Owner decision 2026-09-05 (audit P2 #18): the model version leaves the
  // list and lives on the profile, where the readiness contract already
  // carries it; PRIVACY.md §12 now points there.
  it('does not print the model version under the list', async () => {
    render(<RecommendationsScreen lang="ar" profileId="p1" />);
    await screen.findByLabelText('ذوقك حتى الآن');

    expect(screen.queryByText(/إصدار النموذج/)).toBeNull();
    expect(screen.queryByText(/test-v1/)).toBeNull();
  });

  it('leans on the traits the items agree on', async () => {
    render(<RecommendationsScreen lang="ar" profileId="p1" />);

    await waitFor(() => expect(screen.getByText('غموض مقصود')).toBeInTheDocument());
  });

  it('shows each track as a shelf, and gives the full cards back when it is opened', async () => {
    const user = userEvent.setup();
    const { container } = render(<RecommendationsScreen lang="ar" profileId="p1" />);
    await screen.findByLabelText('ذوقك حتى الآن');

    // The actual rating source is visible on the shelf; the detailed reading
    // stays behind a disclosure, with the full card available on expansion.
    expect(container.querySelectorAll('[class*="rail"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[class*="metaRow"]')).toHaveLength(0);
    expect(container.querySelector('summary img[alt="IMDb"]')).not.toBeNull();
    expect(container.querySelectorAll('details[open]')).toHaveLength(0);
    for (const date of screen.getAllByText(/بتاريخ/)) expect(date).not.toBeVisible();
    expect(screen.queryByText('غير معروف بعد')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'أضف إلى قائمتي' }).length).toBeGreaterThan(0);

    // Every track still expands for secondary detail, while saving and
    // marking watched are already available on its compact tiles.
    await user.click(screen.getAllByRole('button', { name: 'افتح المسار' })[0]);

    expect(container.querySelectorAll('[class*="rail"]').length).toBeLessThan(3);
    expect(container.querySelectorAll('[class*="metaRow"]').length).toBeGreaterThan(0);
    expect(container.querySelector('img[alt="IMDb"]')).not.toBeNull();
    expect(screen.getAllByText(/بتاريخ/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'أضف إلى قائمتي' }).length).toBeGreaterThan(0);
  });

  it('saves from the shelf without opening a film and shows the saved outcome in place', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    mockApi.setTitleState.mockResolvedValue({});
    render(<RecommendationsScreen lang="ar" profileId="p1" onOpenTitle={open} />);
    const card = await screen.findByRole('article', { name: 'يد إلهية' });
    await user.click(within(card).getByRole('button', { name: 'أضف إلى قائمتي' }));
    expect(mockApi.setTitleState).toHaveBeenCalledWith('p1', 'a', { state: 'watchlist' });
    expect(mockApi.recordOutcome).toHaveBeenCalledWith('r-a', 'saved');
    expect(within(card).getByRole('button', { name: 'في قائمتك' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('أُضيف «يد إلهية» إلى قائمتك.');
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the featured film with the same recommendation context and its supplied artwork', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const featured = { ...item('b', 'لا بلد للعجائز', 'safe'), title: { ...title('b', 'لا بلد للعجائز'), posterUrl: 'https://images.example/actual-b.jpg' } };
    mockApi.getRecommendations.mockResolvedValue({ state: 'ready', items: [item('a', 'يد إلهية', 'safe'), featured] });
    render(<RecommendationsScreen lang="ar" profileId="p1" onOpenTitle={open} />);
    const hero = await screen.findByRole('region', { name: 'قرار الليلة' });
    expect(hero.style.getPropertyValue('--hero-image')).toBe('url("https://images.example/actual-b.jpg")');
    await user.click(within(hero).getByRole('button', { name: 'اكتشف الفيلم' }));
    expect(open).toHaveBeenCalledWith(featured, 2, 2, false);
    expect(mockApi.recordOutcome).toHaveBeenCalledWith('r-b', 'clicked');
  });

  it('keeps each film locked until its own request settles and permits retry after failure', async () => {
    const user = userEvent.setup();
    const first = deferred<object>();
    const second = deferred<object>();
    mockApi.setTitleState.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<RecommendationsScreen lang="ar" profileId="p1" />);
    const a = within(await screen.findByRole('article', { name: 'يد إلهية' }));
    const b = within(screen.getByRole('article', { name: 'لا بلد للعجائز' }));
    await user.click(a.getByRole('button', { name: 'أضف إلى قائمتي' }));
    await user.click(b.getByRole('button', { name: 'أضف إلى قائمتي' }));
    expect(mockApi.setTitleState).toHaveBeenCalledTimes(2);
    expect(a.getByRole('button', { name: 'شاهدته' })).toBeDisabled();
    expect(b.getByRole('button', { name: 'شاهدته' })).toBeDisabled();
    await user.click(a.getByRole('button', { name: 'شاهدته' }));
    expect(mockApi.recordWatchEvent).not.toHaveBeenCalled();
    await act(async () => second.resolve({}));
    expect(b.getByRole('button', { name: 'في قائمتك' })).toBeDisabled();
    expect(a.getByRole('button', { name: 'شاهدته' })).toBeDisabled();
    await act(async () => first.reject(new Error('save failed')));
    expect(screen.getByRole('alert')).toHaveTextContent('تعذّر الحفظ');
    expect(a.getByRole('button', { name: 'شاهدته' })).toBeEnabled();
    await user.click(a.getByRole('button', { name: 'شاهدته' }));
    expect(mockApi.recordWatchEvent).toHaveBeenCalledWith('p1', expect.objectContaining({ titleId: 'a', recommendationId: 'r-a' }));
    expect(screen.queryByRole('article', { name: 'يد إلهية' })).toBeNull();
  });

  it('restores saved bookmarks on remount and passes that state into the film context', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const first = render(<RecommendationsScreen lang="ar" profileId="p1" onOpenTitle={open} />);
    const a = within(await screen.findByRole('article', { name: 'يد إلهية' }));
    await user.click(a.getByRole('button', { name: 'أضف إلى قائمتي' }));
    first.unmount();
    mockApi.getWatchlist.mockResolvedValue([{ titleId: 'a' }]);
    render(<RecommendationsScreen lang="ar" profileId="p1" onOpenTitle={open} />);
    const restored = within(await screen.findByRole('article', { name: 'يد إلهية' }));
    expect(await restored.findByRole('button', { name: 'في قائمتك' })).toBeDisabled();
    await user.click(restored.getByRole('button', { name: 'يد إلهية' }));
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ recommendationId: 'r-a' }), 1, 2, true);
    expect(mockApi.getWatchlist).toHaveBeenCalledTimes(2);
  });

  it('does not erase a confirmed save when an older watchlist snapshot arrives', async () => {
    const user = userEvent.setup();
    const watchlist = deferred<Array<{ titleId: string }>>();
    mockApi.getWatchlist.mockReturnValueOnce(watchlist.promise);
    render(<RecommendationsScreen lang="ar" profileId="p1" />);
    const a = within(await screen.findByRole('article', { name: 'يد إلهية' }));
    expect(mockApi.getWatchlist).toHaveBeenCalledWith('p1');
    await user.click(a.getByRole('button', { name: 'أضف إلى قائمتي' }));
    expect(a.getByRole('button', { name: 'في قائمتك' })).toBeDisabled();
    await act(async () => watchlist.resolve([]));
    expect(a.getByRole('button', { name: 'في قائمتك' })).toBeDisabled();
  });

  it('isolates old profile reads and pending saves from a replacement profile', async () => {
    const user = userEvent.setup();
    const watchlist = deferred<Array<{ titleId: string }>>();
    const save = deferred<object>();
    mockApi.getWatchlist.mockReturnValueOnce(watchlist.promise);
    mockApi.setTitleState.mockReturnValueOnce(save.promise);
    const { rerender } = render(<RecommendationsScreen lang="ar" profileId="p1" />);
    const a = within(await screen.findByRole('article', { name: 'يد إلهية' }));
    await user.click(a.getByRole('button', { name: 'أضف إلى قائمتي' }));
    rerender(<RecommendationsScreen lang="ar" profileId="p2" />);
    const replacement = within(await screen.findByRole('article', { name: 'يد إلهية' }));
    expect(mockApi.getWatchlist).toHaveBeenLastCalledWith('p2');
    expect(replacement.getByRole('button', { name: 'أضف إلى قائمتي' })).toBeEnabled();
    await act(async () => { watchlist.resolve([{ titleId: 'a' }]); save.resolve({}); });
    expect(replacement.queryByRole('button', { name: 'في قائمتك' })).toBeNull();
    expect(replacement.getByRole('button', { name: 'أضف إلى قائمتي' })).toBeEnabled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(mockApi.setTitleState).toHaveBeenCalledWith('p1', 'a', { state: 'watchlist' });
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

  it.each([
    ['model_service_unreachable', 'تعذّر الوصول إلى خدمة النموذج'],
    ['model_service_disabled', 'التدريب غير مفعَّل على هذا الخادم'],
    ['paused', 'المعالجة موقوفة مؤقتًا'],
  ])('shows %s training refusals as errors', async (reason, message) => {
    const user = userEvent.setup();
    mockApi.getRecommendations.mockResolvedValue(pending(0, { state: 'failed', errorKind: 'error', jobId: 'job-2' }));
    mockApi.requestTraining.mockRejectedValue(new ApiError('unavailable', 503, { reason }));
    render(<RecommendationsScreen lang="ar" profileId="p1" />);
    await user.click(await screen.findByRole('button', { name: /أعد المحاولة/ }));
    const refusal = await screen.findByText(message);
    expect(refusal).toHaveAttribute('role', 'alert');
    expect(refusal.closest('[data-tone]')).toHaveAttribute('data-tone', 'error');
  });
});
