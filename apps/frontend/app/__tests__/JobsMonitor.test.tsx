import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsMonitor } from '../components/admin/monitoring/JobsMonitor';

const replace = vi.fn();
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/monitoring/jobs',
  useSearchParams: () => currentParams,
}));

vi.mock('../lib/api', () => ({
  api: { adminGetJobs: vi.fn() },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as { adminGetJobs: ReturnType<typeof vi.fn> };

const JOBS = {
  items: [
    {
      id: 'j1', type: 'republish_fingerprints', status: 'succeeded', params: null, dryRun: false,
      progress: { processed: 10, total: 10, titlesChanged: 2, keysChanged: 3 }, result: { scanned: 10 },
      attempts: 1, lastError: null, nextAttemptAt: '2026-09-06T00:00:00.000Z', cancelRequested: false,
      requestedBy: 'u1', idempotencyKey: null, startedAt: '2026-09-06T00:00:00.000Z', finishedAt: '2026-09-06T00:00:01.000Z',
      createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:01.000Z',
    },
  ],
  total: 1, page: 1, limit: 50, totalPages: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  currentParams = new URLSearchParams();
  mockApi.adminGetJobs.mockResolvedValue(JOBS);
});

// ADMIN-W5: read-only view of the job queue -- never imports a mutation
// client (the monitoring/administration separation every other section
// follows, ADR-117 "Decision — separation").
describe('JobsMonitor', () => {
  it('translates the job status and shows progress instead of a raw status code', async () => {
    render(<JobsMonitor />);
    await waitFor(() => expect(screen.getAllByText('انتهت بنجاح').length).toBeGreaterThan(0));
    expect(screen.getAllByText('10 / 10').length).toBeGreaterThan(0);
    expect(screen.queryByText('succeeded')).toBeNull();
  });

  it('filters by status and resets to page 1', async () => {
    currentParams = new URLSearchParams({ page: '3' });
    render(<JobsMonitor />);
    await waitFor(() => expect(mockApi.adminGetJobs).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(screen.getByRole('combobox'), 'failed');
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining('status=failed'), { scroll: false }));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('page=1'), { scroll: false });
  });
});
