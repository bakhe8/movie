import '../../jest-dom-vitest';
/**
 * ResetPasswordScreen — where the emailed link lands (ADR-85)
 *
 * Covers:
 * 1. No token in the link: the invalid-link message, no form
 * 2. Mismatched passwords never reach the API
 * 3. A matching pair confirms with the token and shows the way to log in
 * 4. A 400 from the service reads as an invalid or expired link
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetPasswordScreen } from '../reset-password/ResetPasswordScreen';

vi.mock('../lib/api', () => ({
  api: {
    confirmPasswordReset: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
}));

import { api, ApiError } from '../lib/api';
const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
});

async function fill(user: ReturnType<typeof userEvent.setup>, password: string, confirm: string) {
  await user.type(screen.getByLabelText('كلمة المرور الجديدة'), password);
  await user.type(screen.getByLabelText('تأكيد كلمة المرور'), confirm);
  await user.click(screen.getByRole('button', { name: 'عيّن كلمة المرور' }));
}

describe('ResetPasswordScreen', () => {
  it('shows the invalid-link message and no form without a token', () => {
    render(<ResetPasswordScreen token={null} lang="ar" />);

    expect(screen.getByRole('alert')).toHaveTextContent('غير صالح أو انتهت صلاحيته');
    expect(screen.queryByLabelText('كلمة المرور الجديدة')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'إلى تسجيل الدخول' })).toHaveAttribute('href', '/?lang=ar');
  });

  it('never sends mismatched passwords', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordScreen token="abc" lang="ar" />);

    await fill(user, 'longpassword1', 'longpassword2');

    expect(screen.getByRole('alert')).toHaveTextContent('غير متطابقتين');
    expect(mockApi.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('confirms with the token and points to the door', async () => {
    mockApi.confirmPasswordReset.mockResolvedValue({ reset: true });
    const user = userEvent.setup();
    render(<ResetPasswordScreen token="abc" lang="ar" />);

    await fill(user, 'longpassword1', 'longpassword1');

    expect(mockApi.confirmPasswordReset).toHaveBeenCalledWith('abc', 'longpassword1');
    expect(await screen.findByRole('status')).toHaveTextContent('تم تعيين كلمة المرور الجديدة');
    expect(screen.getByRole('link', { name: 'إلى تسجيل الدخول' })).toHaveAttribute('href', '/?lang=ar');
    expect(screen.queryByLabelText('كلمة المرور الجديدة')).not.toBeInTheDocument();
  });

  it('reads a 400 as an invalid or expired link', async () => {
    mockApi.confirmPasswordReset.mockRejectedValue(new ApiError('Reset token is invalid or expired', 400));
    const user = userEvent.setup();
    render(<ResetPasswordScreen token="spent" lang="en" />);

    await user.type(screen.getByLabelText('New password'), 'longpassword1');
    await user.type(screen.getByLabelText('Confirm password'), 'longpassword1');
    await user.click(screen.getByRole('button', { name: 'Set the password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    expect(screen.getByRole('button', { name: 'Set the password' })).toBeInTheDocument();
  });
});
