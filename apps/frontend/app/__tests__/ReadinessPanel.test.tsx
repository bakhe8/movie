import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityReadiness, ProfileReadiness } from '../lib/api';
import { ReadinessPanel } from '../components/ReadinessPanel';

vi.mock('../lib/api', () => ({ api: { getReadiness: vi.fn() } }));

import { api } from '../lib/api';
const mockApi = api as unknown as { getReadiness: ReturnType<typeof vi.fn> };

const capability = (over: Partial<CapabilityReadiness> = {}): CapabilityReadiness => ({
  status: 'not_ready',
  reason: null,
  action: null,
  publishedAt: null,
  modelVersion: null,
  ...over,
});

const readiness = (over: Partial<ProfileReadiness> = {}): ProfileReadiness => ({
  // ADR-108: the response also carries the round counts. This panel does not
  // read them; the fixture keeps the shape whole.
  rounds: { learningRounds: 0, verificationRounds: 0, firstTrainingAt: 3, nextTrainingAt: 3, watchedTitles: 0, suggestedWatchedTitles: 9 },
  ordinalModel: capability(),
  semanticProfile: capability(),
  recommendation: capability(),
  availability: capability({ reason: 'no_availability_data_source' }),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReadinessPanel (ADR-103 on screen)', () => {
  it('names all four capabilities separately, not one "trained or not"', async () => {
    mockApi.getReadiness.mockResolvedValue(readiness());
    render(<ReadinessPanel profileId="p1" lang="ar" />);

    await waitFor(() => expect(screen.getByText('ترتيب أفلامك')).toBeInTheDocument());
    expect(screen.getByText('ملامح ذوقك')).toBeInTheDocument();
    expect(screen.getByText('اقتراح أفلام جديدة')).toBeInTheDocument();
    expect(screen.getByText('أين تشاهده')).toBeInTheDocument();
  });

  it('tells the two "no suggestions" cases apart: no model, versus no candidates', async () => {
    mockApi.getReadiness.mockResolvedValue(
      readiness({
        ordinalModel: capability({ status: 'ready', modelVersion: 'v7', publishedAt: '2026-09-01T00:00:00.000Z' }),
        recommendation: capability({ status: 'not_ready', reason: 'insufficient_eligible_candidates' }),
      }),
    );
    render(<ReadinessPanel profileId="p1" lang="ar" />);

    await waitFor(() => expect(screen.getByText(/لا توجد أفلام جديدة كافية/)).toBeInTheDocument());
    expect(screen.getByText(/النموذج v7/)).toBeInTheDocument();
    expect(screen.queryByText(/لم تكتمل جولات ترتيب/)).toBeNull();
  });

  it('says what is needed from the user when something is', async () => {
    mockApi.getReadiness.mockResolvedValue(
      readiness({ ordinalModel: capability({ status: 'not_ready', reason: 'insufficient_triads', action: 'rank_more_triads' }) }),
    );
    render(<ReadinessPanel profileId="p1" lang="ar" />);

    await waitFor(() => expect(screen.getByText(/جولة ترتيب أخرى/)).toBeInTheDocument());
  });

  it('is honest about availability instead of claiming a film is unavailable', async () => {
    mockApi.getReadiness.mockResolvedValue(readiness());
    render(<ReadinessPanel profileId="p1" lang="en" />);

    await waitFor(() => expect(screen.getByText(/No availability source yet/)).toBeInTheDocument());
    expect(screen.queryByText(/unavailable/i)).toHaveTextContent(/will not claim it is unavailable/);
  });

  it('says so when readiness itself cannot be read, rather than showing an empty panel', async () => {
    mockApi.getReadiness.mockRejectedValue(new Error('offline'));
    render(<ReadinessPanel profileId="p1" lang="ar" />);

    await waitFor(() => expect(screen.getByText(/تعذّرت قراءة حالة الجاهزية/)).toBeInTheDocument());
  });

  it('asks for nothing until there is a profile', () => {
    render(<ReadinessPanel profileId={null} lang="ar" />);
    expect(mockApi.getReadiness).not.toHaveBeenCalled();
  });

  it('re-reads after a training request (refreshKey)', async () => {
    mockApi.getReadiness.mockResolvedValue(readiness());
    const { rerender } = render(<ReadinessPanel profileId="p1" lang="ar" refreshKey={0} />);
    await waitFor(() => expect(mockApi.getReadiness).toHaveBeenCalledTimes(1));

    rerender(<ReadinessPanel profileId="p1" lang="ar" refreshKey={1} />);
    await waitFor(() => expect(mockApi.getReadiness).toHaveBeenCalledTimes(2));
  });
});
