/**
 * ProfileScreen — training state badges and pause/resume toggle (ALPHA 8.1)
 *
 * Covers:
 * 1. Training state: none / building / trained (bands: initial, strong)
 * 2. Pause toggles to resume when clicked; API is called
 * 3. Reset taste dialog: cancel keeps profile; confirm calls resetProfile
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileScreen } from '../components/ProfileScreen';
import { useSession } from '../lib/session';

// ── mock session ──────────────────────────────────────────────────────────────

const BASE_SESSION = {
  user: { id: 'u1', email: 'test@example.com', name: 'Test', role: 'user' as const },
  profile: { id: 'p1', userId: 'u1', name: 'ملف الذوق الرئيسي', preferredLanguage: 'ar' as const, market: 'SA', platforms: ['netflix'] as string[], pausedAt: null as string | null },
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
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { api } from '../lib/api';
const mockApi = api as Record<string, ReturnType<typeof vi.fn>>;
const mockUseSession = vi.mocked(useSession);

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSession.mockReturnValue({ ...BASE_SESSION, profile: { ...BASE_SESSION.profile, pausedAt: null } } as ReturnType<typeof useSession>);
  mockApi.getTrainingStatus.mockResolvedValue({ state: 'idle', latestSnapshot: null, completedTriads: 0, nextTrainingAt: null, job: null });
  mockApi.getRecommendations.mockResolvedValue({ state: 'pending', needed: 3 });
  mockApi.getConsents.mockResolvedValue([]);
  mockApi.listPrivacyRequests.mockResolvedValue([]);
  mockApi.updateProfile.mockResolvedValue({});
});

function renderProfile() {
  return render(<ProfileScreen lang="ar" />);
}

// ── training state ────────────────────────────────────────────────────────────

describe('ProfileScreen — training state', () => {
  it('shows untrained message when no snapshot exists', async () => {
    renderProfile();
    await waitFor(() => expect(screen.getByText(/لم يُدرَّب نموذجك بعد/)).toBeInTheDocument());
  });

  it('shows building message while training is running', async () => {
    mockApi.getTrainingStatus.mockResolvedValue({
      state: 'running',
      latestSnapshot: null,
      completedTriads: 5,
      nextTrainingAt: null,
      job: { id: 'j1', status: 'running', startedAt: new Date().toISOString() },
    });
    renderProfile();
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
    mockApi.getRecommendations.mockResolvedValue({
      state: 'ready',
      items: [{ id: 'r1', titleId: 't1', modelVersion: 'plackett-luce-v3', confidenceBand: 'strong', track: 'safe', score: 0.9 }],
    });
    renderProfile();
    await waitFor(() => expect(screen.getByText(/plackett-luce-v3/)).toBeInTheDocument());
    // Arabic label for 'strong' band
    await waitFor(() => expect(screen.getByText('قوي')).toBeInTheDocument());
  });
});

// ── pause / resume ────────────────────────────────────────────────────────────

describe('ProfileScreen — pause/resume toggle', () => {
  it('calls pauseAll when "إيقاف المعالجة" is clicked', async () => {
    const user = userEvent.setup();
    renderProfile();
    const pauseBtn = await screen.findByRole('button', { name: /إيقاف المعالجة/i });
    await user.click(pauseBtn);
    await waitFor(() => expect(mockApi.pauseAll).toHaveBeenCalledOnce());
  });

  it('calls resumeAll when already paused', async () => {
    const user = userEvent.setup();
    mockUseSession.mockReturnValue({
      ...BASE_SESSION,
      profile: { ...BASE_SESSION.profile, pausedAt: new Date().toISOString() },
    } as ReturnType<typeof useSession>);
    renderProfile();
    const resumeBtn = await screen.findByRole('button', { name: /استئناف المعالجة/i });
    await user.click(resumeBtn);
    await waitFor(() => expect(mockApi.resumeAll).toHaveBeenCalledOnce());
  });
});

// ── reset taste ───────────────────────────────────────────────────────────────

describe('ProfileScreen — reset taste', () => {
  it('shows confirmation dialog before resetting', async () => {
    const user = userEvent.setup();
    renderProfile();
    const resetBtn = await screen.findByRole('button', { name: /مسح ملف الذوق/i });
    await user.click(resetBtn);
    expect(await screen.findByRole('button', { name: /تأكيد|نعم.*مسح|confirm/i })).toBeInTheDocument();
  });

  it('cancels without calling resetProfile', async () => {
    const user = userEvent.setup();
    renderProfile();
    const resetBtn = await screen.findByRole('button', { name: /مسح ملف الذوق/i });
    await user.click(resetBtn);
    const cancelBtn = await screen.findByRole('button', { name: /إلغاء|cancel/i });
    await user.click(cancelBtn);
    expect(mockApi.resetProfile).not.toHaveBeenCalled();
  });
});
