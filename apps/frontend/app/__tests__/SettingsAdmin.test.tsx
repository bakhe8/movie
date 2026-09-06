import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsAdmin } from '../components/admin/administration/SettingsAdmin';

const { MockApiError } = vi.hoisted(() => ({
  MockApiError: class MockApiError extends Error {
    status: number;
    details: Record<string, unknown>;
    constructor(message: string, status: number, details: Record<string, unknown> = {}) {
      super(message);
      this.status = status;
      this.details = details;
    }
  },
}));

vi.mock('../lib/api', () => ({
  ApiError: MockApiError,
  api: {
    adminGetSettings: vi.fn(),
    adminGetSetting: vi.fn(),
    adminPreviewSetting: vi.fn(),
    adminUpdateSetting: vi.fn(),
    adminRollbackSetting: vi.fn(),
  },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as {
  adminGetSettings: ReturnType<typeof vi.fn>; adminGetSetting: ReturnType<typeof vi.fn>;
  adminPreviewSetting: ReturnType<typeof vi.fn>; adminUpdateSetting: ReturnType<typeof vi.fn>; adminRollbackSetting: ReturnType<typeof vi.fn>;
};

const SETTING = {
  key: 'catalog.min_titles', name: 'أدنى عدد أفلام لبدء التدريب', description: 'شرح الإعداد', unit: 'فيلم', type: 'number' as const,
  value: 200, source: 'default' as const, version: 0, needsRestart: false, modifiedBy: null, modifiedAt: null, reason: null,
};
const HISTORY = [
  { id: 'v1', key: 'catalog.min_titles', value: 200, version: 1, modifiedBy: 'u1', reason: 'أول نشر', createdAt: '2026-01-01T00:00:00.000Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.adminGetSettings.mockResolvedValue([SETTING]);
  mockApi.adminGetSetting.mockResolvedValue({ setting: SETTING, history: [] });
});

// ADMIN-W6 (plan §17.3): the only screen that publishes or rolls back a
// setting -- preview before publish, a required reason, and a real
// version-conflict readback instead of silently clobbering someone else's
// more recent change.
describe('SettingsAdmin', () => {
  it('does not preview or publish just by loading the form', async () => {
    render(<SettingsAdmin />);
    await waitFor(() => expect(screen.getByText('شرح الإعداد')).toBeInTheDocument());
    expect(mockApi.adminPreviewSetting).not.toHaveBeenCalled();
    expect(mockApi.adminUpdateSetting).not.toHaveBeenCalled();
  });

  it('keeps publish disabled until a reason is entered', async () => {
    render(<SettingsAdmin />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'نشر' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'نشر' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/سبب التعديل/), 'موسم جديد');
    expect(screen.getByRole('button', { name: 'نشر' })).not.toBeDisabled();
  });

  it('shows the validation error from a preview without publishing', async () => {
    mockApi.adminPreviewSetting.mockResolvedValue({ valid: false, error: 'يجب أن يكون عدداً صحيحاً بين 1 و100000', current: 200, proposed: -5, needsRestart: false });
    render(<SettingsAdmin />);
    await waitFor(() => expect(screen.getByLabelText(/القيمة الجديدة/)).toBeInTheDocument());

    await userEvent.clear(screen.getByLabelText(/القيمة الجديدة/));
    await userEvent.type(screen.getByLabelText(/القيمة الجديدة/), '-5');
    await userEvent.click(screen.getByRole('button', { name: 'معاينة' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('يجب أن يكون عدداً صحيحاً');
    expect(mockApi.adminUpdateSetting).not.toHaveBeenCalled();
  });

  it('publishes with the loaded version and a reason, then reads back the new state', async () => {
    mockApi.adminUpdateSetting.mockResolvedValue({ ...SETTING, value: 300, version: 1, source: 'control_plane' });
    mockApi.adminGetSetting.mockResolvedValueOnce({ setting: SETTING, history: [] })
      .mockResolvedValueOnce({ setting: { ...SETTING, value: 300, version: 1, source: 'control_plane' }, history: HISTORY });
    render(<SettingsAdmin />);
    await waitFor(() => expect(screen.getByLabelText(/القيمة الجديدة/)).toBeInTheDocument());

    await userEvent.clear(screen.getByLabelText(/القيمة الجديدة/));
    await userEvent.type(screen.getByLabelText(/القيمة الجديدة/), '300');
    await userEvent.type(screen.getByLabelText(/سبب التعديل/), 'موسم جديد أضاف أفلاماً');
    await userEvent.click(screen.getByRole('button', { name: 'نشر' }));

    await waitFor(() => expect(mockApi.adminUpdateSetting).toHaveBeenCalledWith('catalog.min_titles', {
      value: 300, reason: 'موسم جديد أضاف أفلاماً', expectedVersion: 0,
    }));
    expect(await screen.findByText(/تم النشر. الإصدار الآن v1/)).toBeInTheDocument();
  });

  it('shows the real current version and value on a 409 version conflict', async () => {
    mockApi.adminUpdateSetting.mockRejectedValue(new MockApiError('Conflict', 409, { reason: 'version_conflict', currentVersion: 3, currentValue: 275 }));
    render(<SettingsAdmin />);
    await waitFor(() => expect(screen.getByLabelText(/القيمة الجديدة/)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/سبب التعديل/), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'نشر' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('v3');
    expect(await screen.findByRole('alert')).toHaveTextContent('275');
  });

  it('rolls back to a historical version', async () => {
    mockApi.adminGetSetting
      .mockResolvedValueOnce({ setting: { ...SETTING, value: 300, version: 2 }, history: [
        { id: 'v2', key: 'catalog.min_titles', value: 300, version: 2, modifiedBy: 'u1', reason: 'x', createdAt: '2026-01-02T00:00:00.000Z' },
        ...HISTORY,
      ] })
      .mockResolvedValueOnce({ setting: { ...SETTING, value: 200, version: 3 }, history: [] });
    mockApi.adminRollbackSetting.mockResolvedValue({ ...SETTING, value: 200, version: 3 });
    render(<SettingsAdmin />);

    const rollbackBtn = await screen.findByRole('button', { name: 'التراجع لهذه القيمة' });
    await userEvent.click(rollbackBtn);

    await waitFor(() => expect(mockApi.adminRollbackSetting).toHaveBeenCalledWith('catalog.min_titles', { toVersion: 1 }));
    expect(await screen.findByText(/تمت العودة إلى قيمة الإصدار v1/)).toBeInTheDocument();
  });
});
