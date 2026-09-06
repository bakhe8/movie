import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminScreen } from '../components/AdminScreen';

// The access boundary has its own dedicated test (AdminAccessBoundary.test.tsx);
// here it is a pass-through so these tests focus on tab behaviour.
vi.mock('../components/admin/AdminAccessBoundary', () => ({
  AdminAccessBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../lib/api', () => ({
  api: {
    adminGetTitles: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 50, totalPages: 0 }),
    adminGetContentFeatures: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, totalPages: 0 }),
    adminReviewFeature: vi.fn(),
    adminGetModels: vi.fn().mockResolvedValue({ versions: [], unregistered: [] }),
    adminGetTrainingJobs: vi.fn().mockResolvedValue({ counts: { queued: 0, running: 0, succeeded: 0, failed: 0 }, recent: [] }),
    adminGetReadiness: vi.fn().mockResolvedValue({
      database: { ok: true },
      catalog: { titles: 400, threshold: 200, ok: true },
      fingerprintCoverage: { published: 380, total: 400, percent: 95, ok: true },
      modelService: { configured: true, reachable: true, ok: true },
    }),
    adminGetPrivacyRequests: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, totalPages: 0 }),
  },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as {
  adminGetTitles: ReturnType<typeof vi.fn>;
  adminGetContentFeatures: ReturnType<typeof vi.fn>;
  adminReviewFeature: ReturnType<typeof vi.fn>;
  adminGetModels: ReturnType<typeof vi.fn>;
  adminGetTrainingJobs: ReturnType<typeof vi.fn>;
  adminGetReadiness: ReturnType<typeof vi.fn>;
  adminGetPrivacyRequests: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.adminGetTitles.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50, totalPages: 0 });
  mockApi.adminGetContentFeatures.mockResolvedValue({ items: [], total: 0, page: 1, totalPages: 0 });
  mockApi.adminGetModels.mockResolvedValue({ versions: [], unregistered: [] });
  mockApi.adminGetTrainingJobs.mockResolvedValue({ counts: { queued: 0, running: 0, succeeded: 0, failed: 0 }, recent: [] });
  mockApi.adminGetReadiness.mockResolvedValue({
    database: { ok: true },
    catalog: { titles: 400, threshold: 200, ok: true },
    fingerprintCoverage: { published: 380, total: 400, percent: 95, ok: true },
    modelService: { configured: true, reachable: true, ok: true },
  });
  mockApi.adminGetPrivacyRequests.mockResolvedValue({ items: [], total: 0, page: 1, totalPages: 0 });
});

describe('AdminScreen models tab (ADMIN-W1 ADM-P1-06/P0-01/P1-07)', () => {
  async function openModelsTab() {
    render(<AdminScreen />);
    await userEvent.click(await screen.findByRole('tab', { name: 'النماذج' }));
  }

  it('shows readiness and the training queue even when the model-version list fails to load', async () => {
    mockApi.adminGetModels.mockRejectedValue(new Error('boom'));
    await openModelsTab();

    await waitFor(() => expect(screen.getByText('متصلة')).toBeInTheDocument()); // ReadinessStrip rendered
    expect(screen.getByText(/طابور التدريب/)).toBeInTheDocument(); // TrainingJobsTable rendered
    expect(screen.getByText('تعذّر تحميل إصدارات النماذج.')).toBeInTheDocument();
  });

  it('renders the real snapshot/profile counts under their corrected field names', async () => {
    mockApi.adminGetModels.mockResolvedValue({
      versions: [{ version: 'v1', rankerType: 'plackett-luce', fingerprintSchemaVersion: 'v1+v2', createdAt: '2026-09-01T00:00:00.000Z', active: true, stats: { modelVersion: 'v1', snapshotCount: 42, profileCount: 7 } }],
      unregistered: [{ modelVersion: 'v2', snapshotCount: 3, profileCount: 2 }],
    });
    await openModelsTab();

    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows the training row\'s server updatedAt, not finishedAt/createdAt', async () => {
    mockApi.adminGetTrainingJobs.mockResolvedValue({
      counts: { queued: 0, running: 0, succeeded: 1, failed: 0 },
      recent: [{
        id: 'j1', profileId: 'profile-aaaaaaaa', status: 'succeeded', attempts: 1, errorKind: null, lastError: null,
        nextAttemptAt: '2020-01-01T00:00:00.000Z',
        createdAt: '2020-01-01T00:00:00.000Z',
        finishedAt: '2020-01-01T00:05:00.000Z',
        updatedAt: '2026-09-06T10:30:00.000Z',
      }],
    });
    await openModelsTab();

    await waitFor(() => expect(screen.getByText(/2026/)).toBeInTheDocument());
    expect(screen.queryByText(/2020/)).toBeNull();
  });
});

describe('AdminScreen features tab (ADMIN-W1 ADM-P1-05)', () => {
  it('applies the server\'s real reviewStatus and drops the row once it no longer matches the active filter', async () => {
    mockApi.adminGetContentFeatures.mockResolvedValue({
      items: [{ id: 'f1', titleId: 't1', featureKey: 'pacing', value: 0.5, extractorVersion: 'v1', reviewStatus: 'unreviewed', title: { id: 't1', internalId: 'DEMO0001', titleEn: 'A Film', titleAr: '' } }],
      total: 1, page: 1, totalPages: 1,
    });
    mockApi.adminReviewFeature.mockResolvedValue({ feature: { id: 'f1', titleId: 't1', featureKey: 'pacing', value: 0.5, extractorVersion: 'v1', reviewStatus: 'sampled', title: null }, correction: null });

    render(<AdminScreen />);
    await userEvent.click(await screen.findByRole('tab', { name: 'مراجعة البصمات' }));
    await screen.findByText('A Film');

    await userEvent.click(screen.getByRole('button', { name: 'عينة' }));

    await waitFor(() => expect(mockApi.adminReviewFeature).toHaveBeenCalledWith('f1', { reviewStatus: 'sampled' }));
    // The active filter is 'unreviewed' by default; a row that became
    // 'sampled' no longer belongs in that view and must disappear, not sit
    // there forever showing a stale status (ADM-P1-05).
    await waitFor(() => expect(screen.queryByText('A Film')).toBeNull());
    expect(screen.getByText('0 صف')).toBeInTheDocument();
  });

  it('surfaces a visible error instead of silently discarding a failed review', async () => {
    mockApi.adminGetContentFeatures.mockResolvedValue({
      items: [{ id: 'f1', titleId: 't1', featureKey: 'pacing', value: 0.5, extractorVersion: 'v1', reviewStatus: 'unreviewed', title: { id: 't1', internalId: 'DEMO0001', titleEn: 'A Film', titleAr: '' } }],
      total: 1, page: 1, totalPages: 1,
    });
    mockApi.adminReviewFeature.mockRejectedValue(new Error('boom'));

    render(<AdminScreen />);
    await userEvent.click(await screen.findByRole('tab', { name: 'مراجعة البصمات' }));
    await screen.findByText('A Film');
    await userEvent.click(screen.getByRole('button', { name: 'عينة' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('تعذّر حفظ المراجعة'));
    // The row stays -- a failed write must not look like a success.
    expect(screen.getByText('A Film')).toBeInTheDocument();
  });
});
