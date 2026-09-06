import '../../jest-dom-vitest';
/**
 * ProfileScreen — training state badges and pause/resume toggle (ALPHA 8.1)
 *
 * Covers:
 * 1. Training state: none / building / trained (bands: initial, strong)
 * 2. Pause toggles to resume when clicked; API is called
 * 3. Reset taste dialog: cancel keeps profile; confirm calls resetProfile
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render as renderView, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileScreen } from '../components/ProfileScreen';
import { useSession } from '../lib/session';
import { AppearanceProvider } from '../lib/appearance';

function render(ui: React.ReactNode) {
  return renderView(<AppearanceProvider>{ui}</AppearanceProvider>);
}

// ── mock session ──────────────────────────────────────────────────────────────

const BASE_SESSION = {
  user: { id: 'u1', email: 'test@example.com', name: 'Test', role: 'user' as const },
  profile: { id: 'p1', userId: 'u1', name: 'ملف الذوق الرئيسي', preferredLanguage: 'ar' as const, market: 'SA', platforms: ['netflix'] as string[], pausedAt: null as string | null },
  token: null as string | null,
  refreshProfile: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  clearError: vi.fn(),
  error: null as string | null,
  ready: true,
};

vi.mock('../lib/session', () => ({
  useSession: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── mock api ──────────────────────────────────────────────────────────────────

vi.mock('../lib/api', () => ({
  api: {
    updateProfile: vi.fn().mockResolvedValue({}),
    getTrainingStatus: vi.fn(),
    getReadiness: vi.fn(),
    getRecommendations: vi.fn(),
    getCompletedTriads: vi.fn().mockResolvedValue([]),
    getWatchedTitles: vi.fn().mockResolvedValue([]),
    getConsents: vi.fn().mockResolvedValue([]),
    listPrivacyRequests: vi.fn().mockResolvedValue([]),
    pauseAll: vi.fn().mockResolvedValue({ paused: 1, pausedAt: new Date().toISOString() }),
    resumeAll: vi.fn().mockResolvedValue({ resumed: 1 }),
    resetProfile: vi.fn().mockResolvedValue({}),
    exportData: vi.fn().mockResolvedValue({}),
    scheduleDelete: vi.fn().mockResolvedValue({}),
    changePassword: vi.fn().mockResolvedValue({ changed: true }),
    requestEmailChange: vi.fn().mockResolvedValue({ accepted: true }),
  },
  getRefreshToken: vi.fn(() => 'current-refresh-token'),
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const mockUseSession = vi.mocked(useSession);

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSession.mockReturnValue({ ...BASE_SESSION, profile: { ...BASE_SESSION.profile, pausedAt: null } } as unknown as ReturnType<typeof useSession>);
  mockApi.getTrainingStatus.mockResolvedValue({ state: 'idle', latestSnapshot: null, completedTriads: 0, nextTrainingAt: null, job: null });
  // The readiness panel lives in the model section (ADR-103); an unmocked
  // rejection here would only add noise to tests about other sections.
  // ADR-108/110: this call also carries the round counts the screen shows and
  // the model's own confidence band, so it is the screen's single source for
  // both -- not a completed-triads list and a one-item recommendation request.
  const notReady = { status: 'not_ready', reason: 'insufficient_triads', action: 'rank_more_triads', publishedAt: null, modelVersion: null, confidenceBand: null };
  mockApi.getReadiness.mockResolvedValue({
    rounds: { learningRounds: 0, verificationRounds: 0, firstTrainingAt: 3, nextTrainingAt: 3, watchedTitles: 0, suggestedWatchedTitles: 9 },
    ordinalModel: notReady,
    semanticProfile: notReady,
    recommendation: notReady,
    availability: { status: 'not_ready', reason: 'no_availability_data_source', action: null, publishedAt: null, modelVersion: null, confidenceBand: null },
  });
  mockApi.getRecommendations.mockResolvedValue({ state: 'pending', needed: 3 });
  mockApi.getConsents.mockResolvedValue([]);
  mockApi.listPrivacyRequests.mockResolvedValue([]);
  mockApi.updateProfile.mockResolvedValue({});
  BASE_SESSION.refreshProfile.mockResolvedValue(undefined);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('ProfileScreen — pending preferences', () => {
  it('locks edits and Back through both the save and the confirming profile refresh', async () => {
    const user = userEvent.setup();
    const write = deferred<object>();
    const refresh = deferred<void>();
    mockApi.updateProfile.mockReturnValue(write.promise);
    BASE_SESSION.refreshProfile.mockReturnValue(refresh.promise);
    render(<ProfileScreen lang="ar" />);
    await user.click(screen.getByRole('button', { name: /التفضيلات/ }));
    const name = screen.getByLabelText('اسم ملف الذوق');
    await user.clear(name);
    await user.type(name, 'Saved name');
    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(mockApi.updateProfile).toHaveBeenCalledTimes(1));
    expect(name).toBeDisabled();
    expect(screen.getByLabelText('لغة الواجهة')).toBeDisabled();
    expect(screen.getByLabelText('السوق')).toBeDisabled();
    expect(screen.getByRole('button', { name: /نتفليكس/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'إلى ملفي' })).toBeDisabled();
    await user.type(name, ' lost edit');
    expect((name as HTMLInputElement).value).toBe('Saved name');

    await act(async () => { write.resolve({}); });
    expect(BASE_SESSION.refreshProfile).toHaveBeenCalledTimes(1);
    expect(name).toBeDisabled();
    expect(screen.queryByText('تم الحفظ.')).toBeNull();
    await act(async () => { refresh.resolve(); });
    expect(name).toBeEnabled();
    expect(screen.getByRole('button', { name: 'إلى ملفي' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('تم الحفظ.');
  });

  it('unlocks the submitted draft after a failed save', async () => {
    const user = userEvent.setup();
    const write = deferred<object>();
    mockApi.updateProfile.mockReturnValue(write.promise);
    render(<ProfileScreen lang="ar" />);
    await user.click(screen.getByRole('button', { name: /التفضيلات/ }));
    const name = screen.getByLabelText('اسم ملف الذوق');
    await user.clear(name);
    await user.type(name, 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    expect(name).toBeDisabled();
    await act(async () => { write.reject(new Error('offline')); });
    expect(name).toBeEnabled();
    expect((name as HTMLInputElement).value).toBe('Keep this draft');
    expect(screen.getByRole('button', { name: 'إلى ملفي' })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('تعذّر الحفظ');
  });
});

// UX_AUDIT_MOBILE_2026-09-05 P1 #10: the profile is a hub of four cards now,
// so a test about the model or about privacy opens that card first, the way a
// reader does.
async function renderProfile(section?: 'ملف الذوق' | 'الخصوصية') {
  const view = render(<ProfileScreen lang="ar" />);
  if (section) {
    await userEvent.setup().click(await screen.findByRole('button', { name: new RegExp(section) }));
  }
  return view;
}


// ── training state ────────────────────────────────────────────────────────────

describe('ProfileScreen — training state', () => {
  it('opens on four cards, not on one long page', async () => {
    render(<ProfileScreen lang="ar" />);

    // The hub names the four and shows nothing else: no 28-country list, no
    // alias id, no consent dates until a card is opened.
    expect(await screen.findByRole('button', { name: /ملف الذوق/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /التفضيلات/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /الحساب/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /الخصوصية/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('السوق')).toBeNull();
  });

  it('takes the reader into a card and back out again', async () => {
    const user = userEvent.setup();
    render(<ProfileScreen lang="ar" />);

    await user.click(await screen.findByRole('button', { name: /التفضيلات/ }));
    expect(screen.getByLabelText('السوق')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'إلى ملفي' }));

    expect(screen.queryByLabelText('السوق')).toBeNull();
    expect(screen.getByRole('button', { name: /الخصوصية/ })).toBeInTheDocument();
  });

  it('shows untrained message when no snapshot exists', async () => {
    await renderProfile('ملف الذوق');
    await waitFor(() => expect(screen.getByText(/لم يُبنَ نموذجك بعد/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /حدّث|درّب/ })).not.toBeInTheDocument();
  });

  it('shows building message while training is running', async () => {
    mockApi.getTrainingStatus.mockResolvedValue({
      state: 'running',
      latestSnapshot: null,
      completedTriads: 5,
      nextTrainingAt: null,
      job: { id: 'j1', status: 'running', startedAt: new Date().toISOString() },
    });
    await renderProfile('ملف الذوق');
    await waitFor(() => expect(screen.getByText(/جارٍ بناء ملفك/)).toBeInTheDocument());
  });

  it('shows model version and confidence band when trained', async () => {
    mockApi.getTrainingStatus.mockResolvedValue({
      state: 'idle',
      latestSnapshot: { modelVersion: 'plackett-luce-v3', trainedAt: new Date().toISOString() },
      completedTriads: 25,
      nextTrainingAt: null,
      job: null,
    });
    // The band comes from readiness now, never from a recommendation.
    mockApi.getReadiness.mockResolvedValue({
      rounds: { learningRounds: 25, verificationRounds: 4, firstTrainingAt: 3, nextTrainingAt: 28, watchedTitles: 12, suggestedWatchedTitles: 9 },
      ordinalModel: { status: 'ready', reason: null, action: null, publishedAt: null, modelVersion: 'plackett-luce-v3', confidenceBand: 'strong' },
      semanticProfile: { status: 'ready', reason: null, action: null, publishedAt: null, modelVersion: 'plackett-luce-v3', confidenceBand: 'strong' },
      recommendation: { status: 'ready', reason: null, action: null, publishedAt: null, modelVersion: 'plackett-luce-v3', confidenceBand: 'strong' },
      availability: { status: 'not_ready', reason: 'no_availability_data_source', action: null, publishedAt: null, modelVersion: null, confidenceBand: null },
    });
    await renderProfile('ملف الذوق');
    // Named twice on this screen: the model section and the readiness panel.
    await waitFor(() => expect(screen.getAllByText(/plackett-luce-v3/).length).toBeGreaterThan(0));
    // Arabic label for 'strong' band
    await waitFor(() => expect(screen.getByText('قوي')).toBeInTheDocument());
    // No recommendation is requested to read a band (ADR-110): asking for
    // one wrote a recommendations row and stamped it shown.
    expect(mockApi.getRecommendations).not.toHaveBeenCalled();
  });
});

// ── pause / resume ────────────────────────────────────────────────────────────

describe('ProfileScreen — pause/resume toggle', () => {
  it('calls pauseAll when "إيقاف المعالجة" is clicked', async () => {
    const user = userEvent.setup();
    await renderProfile('الخصوصية');
    const pauseBtn = await screen.findByRole('button', { name: /إيقاف المعالجة/i });
    await user.click(pauseBtn);
    await waitFor(() => expect(mockApi.pauseAll).toHaveBeenCalledOnce());
  });

  it('calls resumeAll when already paused', async () => {
    const user = userEvent.setup();
    mockUseSession.mockReturnValue({
      ...BASE_SESSION,
      profile: { ...BASE_SESSION.profile, pausedAt: new Date().toISOString() },
    } as unknown as ReturnType<typeof useSession>);
    await renderProfile('الخصوصية');
    const resumeBtn = await screen.findByRole('button', { name: /استئناف المعالجة/i });
    await user.click(resumeBtn);
    await waitFor(() => expect(mockApi.resumeAll).toHaveBeenCalledOnce());
  });
});

// ── reset taste ───────────────────────────────────────────────────────────────

describe('ProfileScreen — reset taste', () => {
  it('shows confirmation dialog before resetting', async () => {
    const user = userEvent.setup();
    await renderProfile('الخصوصية');
    const resetBtn = await screen.findByRole('button', { name: /مسح ملف الذوق/i });
    await user.click(resetBtn);
    expect(await screen.findByRole('button', { name: /تأكيد|نعم.*مسح|confirm/i })).toBeInTheDocument();
  });

  it('cancels without calling resetProfile', async () => {
    const user = userEvent.setup();
    await renderProfile('الخصوصية');
    const resetBtn = await screen.findByRole('button', { name: /مسح ملف الذوق/i });
    await user.click(resetBtn);
    const cancelBtn = await screen.findByRole('button', { name: /إلغاء|cancel/i });
    await user.click(cancelBtn);
    expect(mockApi.resetProfile).not.toHaveBeenCalled();
  });
});

// ── account settings: change email + change password (owner-approved design 2026-09-06)

describe('ProfileScreen — account settings', () => {
  it('requests an email change with the new address and current password, and reports success', async () => {
    const user = userEvent.setup();
    render(<ProfileScreen lang="ar" />);
    await user.click(await screen.findByRole('button', { name: /الحساب/ }));

    await user.type(screen.getByLabelText('البريد الجديد'), 'new@example.com');
    await user.type(screen.getByPlaceholderText('كلمة المرور الحالية'), 'correct-password');
    await user.click(screen.getByRole('button', { name: 'إرسال رابط التأكيد' }));

    await waitFor(() =>
      expect(mockApi.requestEmailChange).toHaveBeenCalledWith({ newEmail: 'new@example.com', currentPassword: 'correct-password' }),
    );
    expect(await screen.findByText('أُرسل رابط التأكيد إلى البريد الجديد.')).toBeInTheDocument();
  });

  it('shows a dedicated message when the current password is wrong', async () => {
    const user = userEvent.setup();
    mockApi.requestEmailChange.mockRejectedValue(new (await import('../lib/api')).ApiError(401, 'Incorrect password'));
    render(<ProfileScreen lang="ar" />);
    await user.click(await screen.findByRole('button', { name: /الحساب/ }));

    await user.type(screen.getByLabelText('البريد الجديد'), 'new@example.com');
    await user.type(screen.getByPlaceholderText('كلمة المرور الحالية'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'إرسال رابط التأكيد' }));

    expect(await screen.findByText('كلمة المرور غير صحيحة.')).toBeInTheDocument();
  });

  it('changes the password with the current session token, keeping it alive', async () => {
    const user = userEvent.setup();
    render(<ProfileScreen lang="ar" />);
    await user.click(await screen.findByRole('button', { name: /الحساب/ }));

    const currentPasswordField = document.getElementById('account-current-password') as HTMLInputElement;
    await user.type(currentPasswordField, 'correct-password');
    await user.type(screen.getByLabelText('كلمة المرور الجديدة'), 'brand-new-password-1');
    await user.click(screen.getByRole('button', { name: 'تغيير كلمة المرور' }));

    await waitFor(() =>
      expect(mockApi.changePassword).toHaveBeenCalledWith({
        currentPassword: 'correct-password',
        newPassword: 'brand-new-password-1',
        refresh_token: 'current-refresh-token',
      }),
    );
    expect(await screen.findByText('تم تغيير كلمة المرور.')).toBeInTheDocument();
  });
});

// ── training failures are said, not swallowed (brief P0-01, live round 2026-09-05)

describe('ProfileScreen — training failures', () => {
  it('names the missing fingerprints and the support code when the last job failed as invalid', async () => {
    mockApi.getTrainingStatus.mockResolvedValue({
      state: 'failed',
      latestSnapshot: null,
      completedTriads: 10,
      nextTrainingAt: 13,
      job: { id: 'job-9', status: 'failed', errorKind: 'invalid', error: 'no fingerprints' },
    });
    await renderProfile('ملف الذوق');
    const alert = await screen.findByText(/لا تملك بعدُ تحليلًا منشورًا/);
    expect(alert).toHaveTextContent(/job-9/);
    expect(screen.queryByText(/لم يُدرَّب نموذجك بعد/)).not.toBeInTheDocument();
  });

  it('says training is not enabled on this server, with no button to press', async () => {
    mockApi.getTrainingStatus.mockResolvedValue({ state: 'disabled', latestSnapshot: null, completedTriads: 10, nextTrainingAt: null, job: null });
    await renderProfile('ملف الذوق');
    await screen.findByText(/غير مفعَّل على هذا الخادم/);
    expect(screen.queryByRole('button', { name: /حدّث نموذجي/ })).not.toBeInTheDocument();
  });

  it('never asks the person to start or retry derived model work', async () => {
    await renderProfile('ملف الذوق');
    await screen.findByText(/يبدأ بناؤه تلقائيًا/);
    expect(screen.queryByRole('button', { name: /حدّث نموذجي|درّب نموذجي/ })).not.toBeInTheDocument();
  });
});
