import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserManagementAdmin } from '../components/admin/administration/UserManagementAdmin';

const replace = vi.fn();
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/administration/users',
  useSearchParams: () => currentParams,
}));

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
  api: { adminGetUsers: vi.fn(), adminUpdateUser: vi.fn() },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as { adminGetUsers: ReturnType<typeof vi.fn>; adminUpdateUser: ReturnType<typeof vi.fn> };

const USERS = {
  items: [
    { id: 'u1', email: 'a@example.com', firstName: 'A', lastName: 'B', role: 'user' as const, active: true, profiles: 2, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'u2', email: 'admin2@example.com', firstName: null, lastName: null, role: 'admin' as const, active: true, profiles: 0, createdAt: '2026-01-01T00:00:00.000Z' },
  ],
  total: 2, page: 1, limit: 50, totalPages: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  currentParams = new URLSearchParams();
  mockApi.adminGetUsers.mockResolvedValue(USERS);
});

// ADMIN-W4 (W0 case A5): the account-edit screen -- the server enforces
// self-change and last-admin protections, this only surfaces the reason.
describe('UserManagementAdmin', () => {
  it('lists accounts and writes the picked row into the URL (the mocked router does not re-navigate, matching the pattern in AdminW3Monitors.test.tsx)', async () => {
    render(<UserManagementAdmin />);
    await waitFor(() => expect(screen.getAllByText('a@example.com').length).toBeGreaterThan(0));

    await userEvent.click(screen.getAllByRole('button', { name: 'تعديل' })[0]);
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('userId=u1'), { scroll: false });
  });

  it('opens the edit panel for the user named by the URL', async () => {
    currentParams = new URLSearchParams({ userId: 'u1' });
    render(<UserManagementAdmin />);
    expect(await screen.findByText('تعديل a@example.com')).toBeInTheDocument();
  });

  it('submits only the changed fields and shows a success banner with an audit link', async () => {
    mockApi.adminUpdateUser.mockResolvedValue({ ...USERS.items[0], active: false });
    currentParams = new URLSearchParams({ userId: 'u1' });
    render(<UserManagementAdmin />);
    await waitFor(() => expect(screen.getByText('تعديل a@example.com')).toBeInTheDocument());

    const activeCheckbox = screen.getByRole('checkbox', { name: 'حساب نشط' });
    await userEvent.click(activeCheckbox);
    await userEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }));

    await waitFor(() => expect(mockApi.adminUpdateUser).toHaveBeenCalledWith('u1', { active: false }));
    expect(await screen.findByRole('link', { name: 'عرض في سجل العمليات' })).toHaveAttribute(
      'href',
      '/admin/monitoring/audit?resource=user&resourceId=u1',
    );
  });

  it('shows the server refusal reason in plain language instead of a generic failure', async () => {
    mockApi.adminUpdateUser.mockRejectedValue(new MockApiError('Forbidden', 403, { reason: 'last_admin' }));
    currentParams = new URLSearchParams({ userId: 'u2' });
    render(<UserManagementAdmin />);
    await waitFor(() => expect(screen.getByText('تعديل admin2@example.com')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('checkbox', { name: 'حساب نشط' }));
    await userEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('آخر حساب مسؤول نشط');
  });
});
