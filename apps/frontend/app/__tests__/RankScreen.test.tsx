/**
 * RankScreen — keyboard reordering and replacement (ALPHA 8.1)
 *
 * Covers:
 * 1. Shows three titles when a triad is ready
 * 2. Move-up / move-down buttons reorder the list
 * 3. Replacement flow: notWatched button → confirm → API called
 * 4. Blocked state when need_more_watched
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RankScreen } from '../components/RankScreen';

// ── mock api ──────────────────────────────────────────────────────────────────

const TRIAD_READY = {
  state: 'ready' as const,
  id: 'triad-1',
  profileId: 'p1',
  titleIds: ['t1', 't2', 't3'],
  displayOrder: ['t1', 't2', 't3'],
  shownAt: new Date().toISOString(),
  policyVersion: 'random-v1',
  selectionPropensity: 1,
  // component reads `items` (inline titles from backend)
  items: [
    { id: 't1', titleEn: 'Eraserhead', titleAr: 'رأس ممحاة', releaseYear: 1977, genres: ['Horror'] },
    { id: 't2', titleEn: 'Mulholland Drive', titleAr: 'مولهولاند درايف', releaseYear: 2001, genres: ['Mystery'] },
    { id: 't3', titleEn: 'The Shining', titleAr: 'البريق', releaseYear: 1980, genres: ['Horror'] },
  ],
};

vi.mock('../lib/api', () => ({
  api: {
    getCurrentTriad: vi.fn(),
    replaceTriadItem: vi.fn(),
    rankTriad: vi.fn(),
    getTitleState: vi.fn().mockResolvedValue(null),
    getCompletedTriads: vi.fn().mockResolvedValue([]),
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { api } from '../lib/api';
const mockApi = api as { getCurrentTriad: ReturnType<typeof vi.fn>; replaceTriadItem: ReturnType<typeof vi.fn>; rankTriad: ReturnType<typeof vi.fn>; getCompletedTriads: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getCurrentTriad.mockResolvedValue(TRIAD_READY);
  mockApi.replaceTriadItem.mockResolvedValue({ ...TRIAD_READY, id: 'triad-2' });
  mockApi.rankTriad.mockResolvedValue({});
  mockApi.getCompletedTriads.mockResolvedValue([]);
});

// ── helpers ───────────────────────────────────────────────────────────────────

function renderRank() {
  return render(<RankScreen lang="ar" profileId="p1" />);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('RankScreen — ready state', () => {
  it('shows all three titles after load', async () => {
    renderRank();
    await waitFor(() => expect(screen.getByText('رأس ممحاة')).toBeInTheDocument());
    expect(screen.getByText('مولهولاند درايف')).toBeInTheDocument();
    expect(screen.getByText('البريق')).toBeInTheDocument();
  });

  it('move-up button moves a title higher in the ranking', async () => {
    const user = userEvent.setup();
    renderRank();
    await waitFor(() => screen.getByText('مولهولاند درايف'));

    // Each card has a "ارفع درجة" button; [1] is card 2's (card 1 is disabled)
    const upBtns = await screen.findAllByRole('button', { name: 'ارفع درجة' });
    await user.click(upBtns[1]); // move item 2 up

    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toContain('مولهولاند درايف');
    expect(items[1].textContent).toContain('رأس ممحاة');
  });

  it('move-down button moves a title lower in the ranking', async () => {
    const user = userEvent.setup();
    renderRank();
    await waitFor(() => screen.getByText('رأس ممحاة'));

    // [0] is card 1's down button (enabled — not the last card)
    const downBtns = await screen.findAllByRole('button', { name: 'أنزل درجة' });
    await user.click(downBtns[0]); // move item 1 down

    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toContain('مولهولاند درايف');
    expect(items[1].textContent).toContain('رأس ممحاة');
  });
});

describe('RankScreen — replacement flow', () => {
  it('calls replaceTriadItem after confirming "not watched"', async () => {
    const user = userEvent.setup();
    renderRank();
    await waitFor(() => screen.getByText('رأس ممحاة'));

    // Click "لم أشاهده" on the first card
    const notWatchedBtns = await screen.findAllByRole('button', { name: 'لم أشاهده' });
    await user.click(notWatchedBtns[0]);

    // Confirm the replacement
    const confirmBtn = await screen.findByRole('button', { name: 'تأكيد الاستبدال' });
    await user.click(confirmBtn);

    await waitFor(() =>
      expect(mockApi.replaceTriadItem).toHaveBeenCalledWith('triad-1', 't1', 'not_watched'),
    );
  });
});

describe('RankScreen — blocked state', () => {
  it('shows need-more-watched message when state is need_more_watched', async () => {
    mockApi.getCurrentTriad.mockResolvedValue({ state: 'need_more_watched', needed: 2 });
    renderRank();
    await waitFor(() =>
      expect(screen.getByText(/فيلمين|2|أفلام/)).toBeInTheDocument(),
    );
  });
});
