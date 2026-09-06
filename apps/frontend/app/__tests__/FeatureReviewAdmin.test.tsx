import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureReviewAdmin } from '../components/admin/administration/FeatureReviewAdmin';

let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentParams,
}));

vi.mock('../lib/api', () => ({
  api: { adminReviewFeature: vi.fn() },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as { adminReviewFeature: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  currentParams = new URLSearchParams({
    featureId: 'f1', titleLabel: 'A Film', featureKey: 'pacing', value: '0.5',
    extractorVersion: 'v1', returnReviewStatus: 'unreviewed', returnPage: '2',
  });
});

// ADMIN-W2 (W0 case F4): the only write in this package. Must never fire on
// load, must stay disabled while pending, and must read back the server's
// real status rather than assuming success.
describe('FeatureReviewAdmin', () => {
  it('does not call the mutation on mount', () => {
    render(<FeatureReviewAdmin />);
    expect(screen.getByText('A Film')).toBeInTheDocument();
    expect(mockApi.adminReviewFeature).not.toHaveBeenCalled();
  });

  it('confirms the sample write, disables the button meanwhile, and reads back the real status', async () => {
    mockApi.adminReviewFeature.mockResolvedValue({ feature: { id: 'f1', reviewStatus: 'sampled' }, correction: null });
    render(<FeatureReviewAdmin />);

    const button = screen.getByRole('button', { name: 'تأكيد أخذ عينة' });
    await userEvent.click(button);

    expect(mockApi.adminReviewFeature).toHaveBeenCalledWith('f1', { reviewStatus: 'sampled' });
    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled());
    await waitFor(() => expect(screen.getByText(/تم الحفظ/)).toBeInTheDocument());
    expect(screen.getByText(/sampled/)).toBeInTheDocument();
  });

  it('surfaces a visible error and allows retry on failure, without a false success message', async () => {
    mockApi.adminReviewFeature.mockRejectedValue(new Error('boom'));
    render(<FeatureReviewAdmin />);

    await userEvent.click(screen.getByRole('button', { name: 'تأكيد أخذ عينة' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('تعذّر حفظ المراجعة'));
    expect(screen.queryByText(/تم الحفظ/)).toBeNull();
    expect(screen.getByRole('button', { name: 'تأكيد أخذ عينة' })).not.toBeDisabled();
  });

  it('builds the return-to-monitoring link from the carried filter/page', () => {
    render(<FeatureReviewAdmin />);
    const back = screen.getByRole('link', { name: 'رجوع إلى المراقبة' });
    const href = back.getAttribute('href') ?? '';
    expect(href.startsWith('/admin/monitoring/reviews?')).toBe(true);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('reviewStatus')).toBe('unreviewed');
    expect(params.get('page')).toBe('2');
  });

  it('shows a safe message instead of a blank screen when no feature is selected', () => {
    currentParams = new URLSearchParams();
    render(<FeatureReviewAdmin />);
    expect(screen.getByText(/لا يوجد سطر محدد/)).toBeInTheDocument();
  });
});
