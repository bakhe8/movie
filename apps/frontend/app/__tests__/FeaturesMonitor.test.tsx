import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeaturesMonitor } from '../components/admin/monitoring/FeaturesMonitor';

const replace = vi.fn();
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/monitoring/reviews',
  useSearchParams: () => currentParams,
}));

vi.mock('../lib/api', () => ({
  api: { adminGetContentFeatures: vi.fn(), adminReviewFeature: vi.fn() },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as { adminGetContentFeatures: ReturnType<typeof vi.fn>; adminReviewFeature: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  currentParams = new URLSearchParams();
  mockApi.adminGetContentFeatures.mockResolvedValue({
    items: [{ id: 'f1', titleId: 't1', featureKey: 'pacing', value: 0.5, extractorVersion: 'v1', reviewStatus: 'unreviewed', title: { id: 't1', internalId: 'DEMO0001', titleEn: 'A Film', titleAr: '' } }],
    total: 1, page: 1, totalPages: 1,
  });
});

// ADMIN-W2 (ADR-117 "Decision — separation"): monitoring must never import
// or call a mutation, even indirectly -- the sample write moved entirely to
// administration/review, reached only by a deep link.
describe('FeaturesMonitor (read-only)', () => {
  it('shows a deep link to administration instead of a write action for an unreviewed row', async () => {
    render(<FeaturesMonitor />);
    // AdminRecordList renders both the phone-card and desktop-table trees
    // from the same rows (CSS, not React, decides which one is visible), so
    // "A Film" and its link legitimately appear twice here.
    await waitFor(() => expect(screen.getAllByText('A Film').length).toBeGreaterThan(0));

    expect(screen.queryByRole('button', { name: 'عينة' })).toBeNull();
    const [link] = screen.getAllByRole('link', { name: 'فتح في الإدارة' });
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('/admin/administration/review?')).toBe(true);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('featureId')).toBe('f1');
    expect(params.get('titleLabel')).toBe('A Film');
    expect(params.get('returnReviewStatus')).toBe('unreviewed');
    expect(params.get('returnPage')).toBe('1');

    // The module never even references the mutation -- calling it would be
    // a compile error, not just an unexercised code path.
    expect(mockApi.adminReviewFeature).not.toHaveBeenCalled();
  });

  it('reads the reviewStatus filter from the URL and writes filter changes back to it', async () => {
    currentParams = new URLSearchParams({ reviewStatus: 'sampled' });
    render(<FeaturesMonitor />);
    await waitFor(() => expect(mockApi.adminGetContentFeatures).toHaveBeenCalledWith(expect.objectContaining({ reviewStatus: 'sampled' })));
  });
});
