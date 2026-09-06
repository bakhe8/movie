import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogMonitor } from '../components/admin/monitoring/AuditLogMonitor';
import { OperationsMonitor } from '../components/admin/monitoring/OperationsMonitor';
import { OverviewMonitor } from '../components/admin/monitoring/OverviewMonitor';
import { TitleDetailMonitor } from '../components/admin/monitoring/TitleDetailMonitor';

let currentParams = new URLSearchParams();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/monitoring/overview',
  useSearchParams: () => currentParams,
}));

// A single mock covering every read call these four screens make -- none of
// them may import or call a mutation (ADR-117 "Decision — separation"); the
// mock object below only ever defines GET-shaped functions, so an
// accidental `adminReviewFeature` or `adminUpdateTitle` call would throw
// "not a function" rather than silently succeed.
vi.mock('../lib/api', () => ({
  api: {
    adminGetAuditLog: vi.fn(),
    adminGetTrainingJobs: vi.fn(),
    adminGetMailOutbox: vi.fn(),
    adminGetMetrics: vi.fn(),
    adminGetTitleDetail: vi.fn(),
    adminGetProvenance: vi.fn(),
  },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as {
  adminGetAuditLog: ReturnType<typeof vi.fn>;
  adminGetTrainingJobs: ReturnType<typeof vi.fn>;
  adminGetMailOutbox: ReturnType<typeof vi.fn>;
  adminGetMetrics: ReturnType<typeof vi.fn>;
  adminGetTitleDetail: ReturnType<typeof vi.fn>;
  adminGetProvenance: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  currentParams = new URLSearchParams();
});

describe('AuditLogMonitor', () => {
  it('translates a known action instead of showing the raw dotted string', async () => {
    mockApi.adminGetAuditLog.mockResolvedValue({
      items: [{ id: 'a1', actorUserId: 'u1', actorRole: 'admin', action: 'admin.content_feature.review', resource: 'content_feature', resourceId: 'f1', status: 'ok', reason: null, createdAt: '2026-09-06T10:00:00.000Z' }],
      total: 1, page: 1, totalPages: 1,
    });
    render(<AuditLogMonitor />);
    await waitFor(() => expect(screen.getAllByText('مراجعة تحليل فيلم').length).toBeGreaterThan(0));
    expect(screen.queryByText('admin.content_feature.review')).toBeNull();
  });

  it('falls back to a readable path for an action it does not recognize', async () => {
    mockApi.adminGetAuditLog.mockResolvedValue({
      items: [{ id: 'a1', actorUserId: null, actorRole: 'system', action: 'some.future.event', resource: 'title', resourceId: null, status: 'ok', reason: null, createdAt: '2026-09-06T10:00:00.000Z' }],
      total: 1, page: 1, totalPages: 1,
    });
    render(<AuditLogMonitor />);
    await waitFor(() => expect(screen.getAllByText('some.future.event'.split('.').join(' › ')).length).toBeGreaterThan(0));
  });
});

describe('OperationsMonitor', () => {
  it('translates mail kind/status instead of showing raw enum values', async () => {
    mockApi.adminGetTrainingJobs.mockResolvedValue({ counts: { queued: 0, running: 0, succeeded: 0, failed: 0 }, recent: [] });
    mockApi.adminGetMailOutbox.mockResolvedValue({
      counts: { pending: 1, delivered: 0, dead: 0 },
      recent: [{ id: 'm1', kind: 'password_reset', status: 'pending', attempts: 1, nextAttemptAt: '2026-09-06T10:00:00.000Z', lastError: null, deliveredAt: null, createdAt: '2026-09-06T09:00:00.000Z' }],
    });
    render(<OperationsMonitor />);
    await waitFor(() => expect(screen.getAllByText('رابط إعادة تعيين كلمة المرور').length).toBeGreaterThan(0));
    expect(screen.getAllByText('بانتظار الإرسال').length).toBeGreaterThan(0);
  });
});

describe('TitleDetailMonitor', () => {
  it('shows the translated analysis status and feature labels for a real title', async () => {
    mockApi.adminGetTitleDetail.mockResolvedValue({
      id: 't1', internalId: 'DEMO0001', titleEn: 'A Film', titleAr: 'فيلم', description: null,
      releaseYear: 1999, genres: ['Drama'], originalLanguage: 'ar', externalIds: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      summary: { hasFingerprint: true, hasV2: true, licenseStatus: 'commercial_allowed', sourceRecords: 1, unreviewedFeatures: 0 },
    });
    mockApi.adminGetProvenance.mockResolvedValue({
      titleId: 't1',
      sourceRecords: [],
      features: [{ id: 'f1', titleId: 't1', featureKey: 'characters.agency', value: 0.7, extractorVersion: 'v1', reviewStatus: 'unreviewed', supersededBy: null, title: null }],
      byExtractor: { v1: { rows: 1, unreviewed: 1, superseded: 0 } },
      licenseStatus: 'commercial_allowed',
    });

    render(<TitleDetailMonitor titleId="t1" />);
    await waitFor(() => expect(screen.getByText('تحليل كامل')).toBeInTheDocument());
    expect(screen.getByText('استقلالية الشخصيات')).toBeInTheDocument();
    expect(screen.getByText(/شخصيات تقود الأحداث/)).toBeInTheDocument();
  });
});

describe('OverviewMonitor', () => {
  it('translates funnel steps and recommendation outcomes', async () => {
    mockApi.adminGetMetrics.mockResolvedValue({
      window: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', days: 30, excludeDomains: [] },
      accounts: { usersTotal: 10, usersActive: 9, registeredInWindow: 3, profilesTotal: 10 },
      funnel: { cohort: 'registered_in_window', size: 3, steps: [{ step: 'registered', count: 3, rate: 1 }, { step: 'trained', count: 1, rate: 0.333 }] },
      triads: { completed: 5, skipped: 1, active: 0, replacements: 0, replacementRate: 0, answerSeconds: { samples: 5, median: 12, p90: 20, mean: 13 } , byPolicy: {} },
      recommendations: { shown: 4, requests: 4, profiles: 2, byTrack: {}, byBand: {}, outcomes: { clicked: 2, saved: 0, opened_provider: 1, dismissed_not_relevant: 0, watched: 1, ranked_later: 0 }, rates: { clickThrough: 0.5, watched: 0.25, rankedLater: null, dismissed: null }, hoursToWatch: { samples: 1, median: 2 } },
      model: { snapshotsInWindow: 2, profilesWithSnapshot: 2, byModelVersion: {}, latestSnapshotByEvidence: {}, meanHeldOutPairwiseAccuracy: 0.62 },
      catalog: { titles: 389, withFingerprint: 384, withV2: 384, withKnownLicense: 297, unreviewedFeatures: 16819 },
      privacy: { requestsByType: {}, pendingDeletes: 0, auditRowsInWindow: 3 },
      daily: [{ day: '2026-08-30', registrations: 1, triadsCompleted: 2, recommendationsShown: 1, watchedOutcomes: 0 }],
    });

    render(<OverviewMonitor />);
    await waitFor(() => expect(screen.getByText('أنشأ حساباً')).toBeInTheDocument());
    expect(screen.getByText('بُني ملف ذوقه')).toBeInTheDocument();
    expect(screen.getByText('نقر على الفيلم')).toBeInTheDocument();
  });

  it('lets the operator choose a different window without auto-polling', async () => {
    mockApi.adminGetMetrics.mockResolvedValue({
      window: { from: '2026-08-25T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', days: 7, excludeDomains: [] },
      accounts: { usersTotal: 0, usersActive: 0, registeredInWindow: 0, profilesTotal: 0 },
      funnel: { cohort: 'registered_in_window', size: 0, steps: [] },
      triads: { completed: 0, skipped: 0, active: 0, replacements: 0, replacementRate: null, answerSeconds: { samples: 0, median: null, p90: null, mean: null }, byPolicy: {} },
      recommendations: { shown: 0, requests: 0, profiles: 0, byTrack: {}, byBand: {}, outcomes: { clicked: 0, saved: 0, opened_provider: 0, dismissed_not_relevant: 0, watched: 0, ranked_later: 0 }, rates: { clickThrough: null, watched: null, rankedLater: null, dismissed: null }, hoursToWatch: { samples: 0, median: null } },
      model: { snapshotsInWindow: 0, profilesWithSnapshot: 0, byModelVersion: {}, latestSnapshotByEvidence: {}, meanHeldOutPairwiseAccuracy: null },
      catalog: { titles: 0, withFingerprint: 0, withV2: 0, withKnownLicense: 0, unreviewedFeatures: 0 },
      privacy: { requestsByType: {}, pendingDeletes: 0, auditRowsInWindow: 0 },
      daily: [],
    });
    render(<OverviewMonitor />);
    await waitFor(() => expect(mockApi.adminGetMetrics).toHaveBeenCalledWith(expect.objectContaining({ days: 30 })));
    const callsAfterLoad = mockApi.adminGetMetrics.mock.calls.length;

    await userEvent.selectOptions(screen.getByRole('combobox'), '7');
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining('days=7'), { scroll: false }));

    // The mocked router does not actually navigate, so the fetch effect
    // cannot re-fire from this click alone in this harness -- what matters
    // here is that no *extra*, unexplained call happened, i.e. nothing
    // auto-polls behind the explicit choice (plan §18 W3: manual refresh,
    // no auto-poll on a costly endpoint).
    expect(mockApi.adminGetMetrics.mock.calls.length).toBe(callsAfterLoad);
  });
});
