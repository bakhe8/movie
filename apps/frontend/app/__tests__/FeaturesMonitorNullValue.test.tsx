import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeaturesMonitor } from '../components/admin/monitoring/FeaturesMonitor';

let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/admin/monitoring/reviews',
  useSearchParams: () => currentParams,
}));

vi.mock('../lib/api', () => ({
  api: { adminGetContentFeatures: vi.fn(), adminReviewFeature: vi.fn(), adminSampleContentFeatures: vi.fn() },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as { adminGetContentFeatures: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  currentParams = new URLSearchParams();
});

// ADMIN-W3: content_features.value is nullable ("NULL means unknown, never
// 0" -- BP §11.3), but AdminContentFeature was wrongly typed non-nullable
// through W1/W2. A real null would have thrown on `.toFixed()`. Guards
// against that regressing.
describe('FeaturesMonitor with a null analysis value', () => {
  it('shows "unknown" instead of crashing when value is null', async () => {
    mockApi.adminGetContentFeatures.mockResolvedValue({
      items: [{ id: 'f1', titleId: 't1', featureKey: 'pacing', value: null, extractorVersion: 'v1', reviewStatus: 'unreviewed', title: { id: 't1', internalId: 'DEMO0001', titleEn: 'A Film', titleAr: '' } }],
      total: 1, page: 1, totalPages: 1,
    });

    render(<FeaturesMonitor />);
    await waitFor(() => expect(screen.getAllByText('غير معروف').length).toBeGreaterThan(0));

    // The deep link must carry no value at all, never the literal "null".
    const [link] = screen.getAllByRole('link', { name: 'مراجعة هذا التحليل' });
    const href = link.getAttribute('href') ?? '';
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('value')).toBe('');
  });
});
