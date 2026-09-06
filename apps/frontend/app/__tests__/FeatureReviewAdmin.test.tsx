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

    const button = screen.getByRole('button', { name: 'تأكيد صحة التحليل' });
    await userEvent.click(button);

    expect(mockApi.adminReviewFeature).toHaveBeenCalledWith('f1', { reviewStatus: 'sampled' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'تأكيد صحة التحليل' })).toBeDisabled());
    await waitFor(() => expect(screen.getByText(/تم الحفظ/)).toBeInTheDocument());
    // The raw status code is never shown -- REVIEW_STATUS_COPY translates it.
    expect(screen.getByText(/رُوجعت وصحيحة/)).toBeInTheDocument();
  });

  it('surfaces a visible error and allows retry on failure, without a false success message', async () => {
    mockApi.adminReviewFeature.mockRejectedValue(new Error('boom'));
    render(<FeatureReviewAdmin />);

    await userEvent.click(screen.getByRole('button', { name: 'تأكيد صحة التحليل' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('تعذّر حفظ المراجعة'));
    expect(screen.queryByText(/تم الحفظ/)).toBeNull();
    expect(screen.getByRole('button', { name: 'تأكيد صحة التحليل' })).not.toBeDisabled();
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

  // ADMIN-W3: value is nullable (BP §11.3 "NULL means unknown, never 0").
  // Number('') is 0, not NaN -- an absent value param must read as unknown,
  // never as a fabricated zero.
  it('shows "unknown" rather than a fabricated zero when no value was carried', () => {
    currentParams = new URLSearchParams({ featureId: 'f1', titleLabel: 'A Film', featureKey: 'pacing' });
    render(<FeatureReviewAdmin />);
    expect(screen.getByText('غير معروف')).toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).toBeNull();
  });

  // ADMIN-W4 (W0 case F4 extension, ADM-P0-02): entering a corrected value
  // must never fire on load, must send exactly what was typed, and must
  // report when the correction reached the published fingerprint.
  describe('entering a correction', () => {
    it('does not call the mutation just by opening the correction form', async () => {
      render(<FeatureReviewAdmin />);
      await userEvent.click(screen.getByRole('button', { name: 'التحليل غير صحيح — إدخال قيمة صحيحة' }));
      expect(screen.getByLabelText('القيمة الصحيحة (بين 0 و1)')).toBeInTheDocument();
      expect(mockApi.adminReviewFeature).not.toHaveBeenCalled();
    });

    it('submits the corrected value and note, and reports the fingerprint republish', async () => {
      mockApi.adminReviewFeature.mockResolvedValue({
        feature: { id: 'f1', reviewStatus: 'human_verified', supersededBy: 'c1' },
        correction: { id: 'c1', reviewStatus: 'human_verified', value: 0.9 },
        republish: { changes: [{ featureKey: 'pacing', before: 0.5, after: 0.9 }] },
      });
      render(<FeatureReviewAdmin />);
      await userEvent.click(screen.getByRole('button', { name: 'التحليل غير صحيح — إدخال قيمة صحيحة' }));
      await userEvent.type(screen.getByLabelText('القيمة الصحيحة (بين 0 و1)'), '0.9');
      await userEvent.type(screen.getByLabelText('ملاحظة (اختياري)'), 'watched it again');
      await userEvent.click(screen.getByRole('button', { name: 'حفظ التصحيح' }));

      await waitFor(() => expect(mockApi.adminReviewFeature).toHaveBeenCalledWith('f1', {
        reviewStatus: 'human_verified', correctedValue: 0.9, note: 'watched it again',
      }));
      expect(await screen.findByText(/انعكس فوراً على بصمة الفيلم المنشورة/)).toBeInTheDocument();
    });

    it('keeps the save button disabled for a value outside 0-1', async () => {
      render(<FeatureReviewAdmin />);
      await userEvent.click(screen.getByRole('button', { name: 'التحليل غير صحيح — إدخال قيمة صحيحة' }));
      await userEvent.type(screen.getByLabelText('القيمة الصحيحة (بين 0 و1)'), '1.5');
      expect(screen.getByRole('button', { name: 'حفظ التصحيح' })).toBeDisabled();
    });
  });
});
