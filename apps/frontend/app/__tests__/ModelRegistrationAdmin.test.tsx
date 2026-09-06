import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelRegistrationAdmin } from '../components/admin/administration/ModelRegistrationAdmin';

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
  api: { adminGetModels: vi.fn(), adminRegisterModel: vi.fn(), adminUpdateModel: vi.fn() },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as {
  adminGetModels: ReturnType<typeof vi.fn>; adminRegisterModel: ReturnType<typeof vi.fn>; adminUpdateModel: ReturnType<typeof vi.fn>;
};

const MODELS = {
  versions: [
    { version: 'v1-a', rankerType: 'plackett-luce', active: true, fingerprintSchemaVersion: 'v1+v2', createdAt: '2026-01-01T00:00:00.000Z', stats: { snapshotCount: 3, profileCount: 2 } },
    { version: 'v1-b', rankerType: 'plackett-luce', active: false, fingerprintSchemaVersion: 'v1+v2', createdAt: '2026-01-01T00:00:00.000Z', stats: null },
  ],
  unregistered: [{ modelVersion: 'v1-c', snapshotCount: 1, profileCount: 1 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.adminGetModels.mockResolvedValue(MODELS);
});

// ADMIN-W4 (W0 case A6, ADM-P0-05): registering never activates -- activation
// is its own explicit, separately-confirmed action per row.
describe('ModelRegistrationAdmin', () => {
  it('lists registered and unregistered versions with their real status labels', async () => {
    render(<ModelRegistrationAdmin />);
    expect(await screen.findByText('v1-a')).toBeInTheDocument();
    expect(screen.getByText('الإصدار المعتمَد حالياً')).toBeInTheDocument();
    expect(screen.getByText('إصدار مسجَّل غير مفعَّل')).toBeInTheDocument();
    expect(screen.getByText('v1-c')).toBeInTheDocument();
    expect(screen.getByText('ظهر تلقائياً من الاستخدام (غير معتمد)')).toBeInTheDocument();
  });

  it('registers a new version without activating it', async () => {
    mockApi.adminRegisterModel.mockResolvedValue({ version: 'v2-new', rankerType: 'x', fingerprintSchemaVersion: 'v1+v2', active: false, codeRef: null, createdAt: '2026-01-01T00:00:00.000Z' });
    render(<ModelRegistrationAdmin />);
    await waitFor(() => expect(mockApi.adminGetModels).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByLabelText('اسم الإصدار'), 'v2-new');
    await userEvent.type(screen.getByLabelText('نوع خوارزمية الترتيب'), 'plackett-luce');
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل' }));

    await waitFor(() => expect(mockApi.adminRegisterModel).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'v2-new', rankerType: 'plackett-luce' }),
    ));
    expect(await screen.findByText('تم تسجيل الإصدار. لم يُفعَّل بعد.')).toBeInTheDocument();
  });

  it('activates an inactive version on explicit confirmation', async () => {
    mockApi.adminUpdateModel.mockResolvedValue({ ...MODELS.versions[1], active: true });
    render(<ModelRegistrationAdmin />);
    await screen.findByText('v1-b');

    await userEvent.click(screen.getByRole('button', { name: 'تفعيل هذا الإصدار' }));
    await waitFor(() => expect(mockApi.adminUpdateModel).toHaveBeenCalledWith('v1-b', { active: true }));
  });

  it('falls back to a generic retry message when activation fails without a known reason', async () => {
    mockApi.adminUpdateModel.mockRejectedValue(new Error('network down'));
    render(<ModelRegistrationAdmin />);
    await userEvent.click(await screen.findByRole('button', { name: 'تفعيل هذا الإصدار' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('تعذّر التفعيل');
  });

  it('surfaces the server reason when registering a version that already exists', async () => {
    mockApi.adminRegisterModel.mockRejectedValue(new MockApiError('Conflict', 409, { reason: 'exists' }));
    render(<ModelRegistrationAdmin />);
    await waitFor(() => expect(mockApi.adminGetModels).toHaveBeenCalledTimes(1));
    await userEvent.type(screen.getByLabelText('اسم الإصدار'), 'v1-a');
    await userEvent.type(screen.getByLabelText('نوع خوارزمية الترتيب'), 'plackett-luce');
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('مسجَّل مسبقاً');
  });
});
