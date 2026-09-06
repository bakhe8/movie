import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { AdminAccessBoundary, useAdminCapabilities } from '../components/admin/AdminAccessBoundary';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, api: { adminGetContext: vi.fn() } };
});
vi.mock('../lib/session', () => ({ useSession: vi.fn() }));

import { api } from '../lib/api';
const mockApi = api as unknown as { adminGetContext: ReturnType<typeof vi.fn> };
const mockUseSession = vi.mocked(useSession);

function session(over: Partial<ReturnType<typeof useSession>> = {}) {
  return {
    ready: true,
    token: 'tok',
    user: null,
    profile: null,
    error: null,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    refreshProfile: vi.fn(),
    ...over,
  } as unknown as ReturnType<typeof useSession>;
}

function CapabilityProbe() {
  const capabilities = useAdminCapabilities();
  return <div data-testid="caps">{capabilities.join(',')}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ADMIN-W1 (ADR-117, AUDIT_2026-09-05 C1/M5): the boundary must distinguish
// every failure mode instead of collapsing them into one "no access" screen,
// and must never probe before session hydration resolves.
describe('AdminAccessBoundary', () => {
  it('does not probe before session.ready resolves', () => {
    mockUseSession.mockReturnValue(session({ ready: false }));
    render(<AdminAccessBoundary><div>محتوى الإدارة</div></AdminAccessBoundary>);
    expect(screen.getByText('جارٍ التحقق من الصلاحية...')).toBeInTheDocument();
    expect(mockApi.adminGetContext).not.toHaveBeenCalled();
  });

  it('shows "sign in" without a network call when session is ready but there is no token', async () => {
    mockUseSession.mockReturnValue(session({ ready: true, token: null }));
    render(<AdminAccessBoundary><div>محتوى الإدارة</div></AdminAccessBoundary>);
    await waitFor(() => expect(screen.getByText('سجّل الدخول لعرض لوحة الإدارة.')).toBeInTheDocument());
    expect(mockApi.adminGetContext).not.toHaveBeenCalled();
  });

  it('renders children and exposes capabilities once the context call resolves', async () => {
    mockUseSession.mockReturnValue(session());
    mockApi.adminGetContext.mockResolvedValue({ user: { id: 'u1', email: 'a@b.com', role: 'admin' }, capabilities: ['catalog.manage'] });
    render(
      <AdminAccessBoundary>
        <CapabilityProbe />
      </AdminAccessBoundary>,
    );
    await waitFor(() => expect(screen.getByTestId('caps')).toHaveTextContent('catalog.manage'));
  });

  it('tells a rejected token apart from a forbidden non-admin account', async () => {
    mockUseSession.mockReturnValue(session());
    mockApi.adminGetContext.mockRejectedValue(new ApiError('Unauthorized', 401));
    render(<AdminAccessBoundary><div /></AdminAccessBoundary>);
    await waitFor(() => expect(screen.getByText('سجّل الدخول لعرض لوحة الإدارة.')).toBeInTheDocument());
  });

  it('shows a distinct message for a signed-in non-admin (403)', async () => {
    mockUseSession.mockReturnValue(session());
    mockApi.adminGetContext.mockRejectedValue(new ApiError('Forbidden', 403, { reason: 'admin_required' }));
    render(<AdminAccessBoundary><div /></AdminAccessBoundary>);
    await waitFor(() => expect(screen.getByText('ليس لديك صلاحية الوصول إلى لوحة الإدارة.')).toBeInTheDocument());
  });

  it('shows a distinct message for a server error, with retry offered', async () => {
    mockUseSession.mockReturnValue(session());
    mockApi.adminGetContext.mockRejectedValue(new ApiError('Internal', 500));
    render(<AdminAccessBoundary><div /></AdminAccessBoundary>);
    await waitFor(() => expect(screen.getByText('خطأ في الخادم أثناء التحقق من الصلاحية.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeInTheDocument();
  });

  it('shows a distinct message for an offline/network failure, with retry offered', async () => {
    mockUseSession.mockReturnValue(session());
    mockApi.adminGetContext.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<AdminAccessBoundary><div /></AdminAccessBoundary>);
    await waitFor(() => expect(screen.getByText('تعذّر الاتصال بالخادم للتحقق من الصلاحية.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeInTheDocument();
  });

  it('retries the probe on demand and recovers', async () => {
    mockUseSession.mockReturnValue(session());
    mockApi.adminGetContext.mockRejectedValueOnce(new ApiError('Internal', 500));
    mockApi.adminGetContext.mockResolvedValueOnce({ user: { id: 'u1', email: 'a@b.com', role: 'admin' }, capabilities: [] });
    render(<AdminAccessBoundary><div>محتوى الإدارة</div></AdminAccessBoundary>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    await waitFor(() => expect(screen.getByText('محتوى الإدارة')).toBeInTheDocument());
    expect(mockApi.adminGetContext).toHaveBeenCalledTimes(2);
  });
});
