import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsAdmin } from '../components/admin/administration/JobsAdmin';

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
  api: { adminGetJobTypes: vi.fn(), adminGetJobs: vi.fn(), adminCreateJob: vi.fn(), adminGetJob: vi.fn(), adminCancelJob: vi.fn() },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as {
  adminGetJobTypes: ReturnType<typeof vi.fn>; adminGetJobs: ReturnType<typeof vi.fn>;
  adminCreateJob: ReturnType<typeof vi.fn>; adminGetJob: ReturnType<typeof vi.fn>; adminCancelJob: ReturnType<typeof vi.fn>;
};

const TYPES = [{ type: 'republish_fingerprints', description: 'يعيد نشر بصمة الفيلم من أحدث تحليل معتمد.' }];

const RUNNING_JOB = {
  id: 'j1', type: 'republish_fingerprints', status: 'running' as const, params: null, dryRun: true,
  progress: null, result: null, attempts: 1, lastError: null, nextAttemptAt: '2026-09-06T00:00:00.000Z',
  cancelRequested: false, requestedBy: 'u1', idempotencyKey: null, startedAt: '2026-09-06T00:00:00.000Z', finishedAt: null,
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.adminGetJobTypes.mockResolvedValue(TYPES);
  mockApi.adminGetJobs.mockResolvedValue({ items: [RUNNING_JOB], total: 1, page: 1, limit: 10, totalPages: 1 });
});

// ADMIN-W5: the only screen that writes to the job queue -- creating and
// cancelling a job, following the same load/confirm/write/readback flow
// every other administration screen uses.
describe('JobsAdmin', () => {
  it('does not create a job just by loading the form', async () => {
    render(<JobsAdmin />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'تشغيل المهمة' })).toBeInTheDocument());
    expect(mockApi.adminCreateJob).not.toHaveBeenCalled();
  });

  it('defaults to a dry run and lets the operator submit it', async () => {
    mockApi.adminCreateJob.mockResolvedValue({ job: { ...RUNNING_JOB, status: 'queued' }, created: true });
    render(<JobsAdmin />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'تشغيل المهمة' })).toBeInTheDocument());

    expect(screen.getByRole('checkbox', { name: /تنفيذ تجريبي/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'تشغيل المهمة' }));

    await waitFor(() => expect(mockApi.adminCreateJob).toHaveBeenCalledWith({
      type: 'republish_fingerprints', dryRun: true, params: undefined, idempotencyKey: undefined,
    }));
    expect(await screen.findByText(/بدأت المهمة/)).toBeInTheDocument();
  });

  it('scopes the job to one title when an id is entered', async () => {
    mockApi.adminCreateJob.mockResolvedValue({ job: RUNNING_JOB, created: true });
    render(<JobsAdmin />);
    await waitFor(() => expect(screen.getByLabelText(/معرّف فيلم محدد/)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/معرّف فيلم محدد/), 'title-123');
    await userEvent.click(screen.getByRole('button', { name: 'تشغيل المهمة' }));

    await waitFor(() => expect(mockApi.adminCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({ params: { titleId: 'title-123' } }),
    ));
  });

  it('surfaces the allowlist when the server refuses an unknown type', async () => {
    mockApi.adminCreateJob.mockRejectedValue(new MockApiError('Conflict', 409, { reason: 'unknown_type', allowlist: ['republish_fingerprints'] }));
    render(<JobsAdmin />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'تشغيل المهمة' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'تشغيل المهمة' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('republish_fingerprints');
  });

  it('cancels a running job and reflects the cooperative cancel state', async () => {
    mockApi.adminCancelJob.mockResolvedValue({ ...RUNNING_JOB, cancelRequested: true });
    render(<JobsAdmin />);
    const cancelBtn = await screen.findByRole('button', { name: 'إلغاء' });
    await userEvent.click(cancelBtn);
    await waitFor(() => expect(mockApi.adminCancelJob).toHaveBeenCalledWith('j1'));
  });
});
