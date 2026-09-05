import '../../jest-dom-vitest';
/**
 * AuthScreen — the password-reset request from the door (ADR-85)
 *
 * Covers:
 * 1. "Forgot your password?" switches to reset mode: email only, no password
 * 2. Submitting calls the request endpoint once and shows the neutral message
 * 3. A failed request shows the failure and keeps the form
 * 4. "Back to log in" restores the login form
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthScreen } from '../components/AuthScreen';

const session = {
  login: vi.fn(),
  register: vi.fn(),
  clearError: vi.fn(),
  error: null as string | null,
};

vi.mock('../lib/session', () => ({
  useSession: () => session,
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../lib/api', () => ({
  CONSENT_VERSION: 'privacy-2.0',
  api: {
    requestPasswordReset: vi.fn(),
    updateConsents: vi.fn().mockResolvedValue([]),
  },
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  session.error = null;
});

// The owner's interaction addendum (2026-09-05): ask for nothing the
// experience does not use. A name shows on no screen but the profile's own
// account card and enters no model, so the door asks for two fields.
describe('AuthScreen — the door asks for two things', () => {
  it('has no name fields when creating an account', async () => {
    const user = userEvent.setup();
    render(<AuthScreen lang="ar" />);

    await user.click(screen.getByRole('button', { name: /أنشئ واحدًا/ }));

    expect(screen.queryByLabelText('الاسم الأول')).toBeNull();
    expect(screen.queryByLabelText('اسم العائلة')).toBeNull();
    expect(screen.getByLabelText('البريد الإلكتروني')).toBeInTheDocument();
    expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument();
  });

  it('registers with the address and the password alone', async () => {
    const user = userEvent.setup();
    render(<AuthScreen lang="ar" />);
    await user.click(screen.getByRole('button', { name: /أنشئ واحدًا/ }));

    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'someone@example.com');
    await user.type(screen.getByLabelText('كلمة المرور'), 'password123');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'إنشاء الحساب' }));

    await waitFor(() => expect(session.register).toHaveBeenCalledWith({ email: 'someone@example.com', password: 'password123' }));
  });
});

describe('AuthScreen password reset', () => {
  it('switches to an email-only reset form from the login screen', async () => {
    const user = userEvent.setup();
    render(<AuthScreen lang="ar" />);

    expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'نسيت كلمة المرور؟' }));

    expect(screen.getByRole('heading', { name: 'استعادة كلمة المرور' })).toBeInTheDocument();
    expect(screen.getByLabelText('البريد الإلكتروني')).toBeInTheDocument();
    expect(screen.queryByLabelText('كلمة المرور')).not.toBeInTheDocument();
    expect(session.clearError).toHaveBeenCalled();
  });

  it('requests the link once and shows the same neutral message for any address', async () => {
    mockApi.requestPasswordReset.mockResolvedValue({ accepted: true });
    const user = userEvent.setup();
    render(<AuthScreen lang="ar" />);

    await user.click(screen.getByRole('button', { name: 'نسيت كلمة المرور؟' }));
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: 'أرسل الرابط' }));

    await waitFor(() => expect(mockApi.requestPasswordReset).toHaveBeenCalledWith('someone@example.com'));
    expect(mockApi.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('إن كان البريد مسجّلًا لدينا');
    expect(screen.queryByRole('button', { name: 'أرسل الرابط' })).not.toBeInTheDocument();
    expect(session.login).not.toHaveBeenCalled();
  });

  it('shows the failure and keeps the form when the request cannot be sent', async () => {
    mockApi.requestPasswordReset.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    render(<AuthScreen lang="en" />);

    await user.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    await user.type(screen.getByLabelText('Email'), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: 'Send the link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be sent');
    expect(screen.getByRole('button', { name: 'Send the link' })).toBeInTheDocument();
  });

  it('returns to the login form', async () => {
    const user = userEvent.setup();
    render(<AuthScreen lang="ar" />);

    await user.click(screen.getByRole('button', { name: 'نسيت كلمة المرور؟' }));
    await user.click(screen.getByRole('button', { name: 'العودة إلى تسجيل الدخول' }));

    expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'دخول' })).toBeInTheDocument();
  });
});
