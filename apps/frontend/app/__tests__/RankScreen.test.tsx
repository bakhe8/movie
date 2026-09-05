import '../../jest-dom-vitest';
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
import { act, render, screen, waitFor } from '@testing-library/react';
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
    getReadiness: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { api } from '../lib/api';
const mockApi = api as unknown as { getCurrentTriad: ReturnType<typeof vi.fn>; replaceTriadItem: ReturnType<typeof vi.fn>; rankTriad: ReturnType<typeof vi.fn>; getReadiness: ReturnType<typeof vi.fn> };

// ADR-108: the screen's counter is the server's, so every render needs one.
const readiness = (rounds: Partial<{ learningRounds: number; verificationRounds: number; watchedTitles: number }> = {}) => ({
  rounds: {
    learningRounds: 0,
    verificationRounds: 0,
    firstTrainingAt: 3,
    nextTrainingAt: 3,
    watchedTitles: 9,
    suggestedWatchedTitles: 9,
    ...rounds,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getCurrentTriad.mockResolvedValue(TRIAD_READY);
  mockApi.replaceTriadItem.mockResolvedValue({ ...TRIAD_READY, id: 'triad-2' });
  mockApi.rankTriad.mockResolvedValue({});
  mockApi.getReadiness.mockResolvedValue(readiness());
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

  // ADR-111: the three slots sit side by side, so each card's controls live
  // behind one menu -- at 375px a column is about 105px wide.
  it("keeps every card control behind that card's own menu", async () => {
    const user = userEvent.setup();
    render(<RankScreen lang="ar" profileId="p1" />);
    await screen.findByText('رأس ممحاة');

    const menus = screen.getAllByLabelText('خيارات هذه البطاقة');
    expect(menus).toHaveLength(3);
    // Closed until asked: the summary is the only control the row shows.
    expect(menus[0].closest('details')).not.toHaveAttribute('open');

    await user.click(menus[0]);

    expect(menus[0].closest('details')).toHaveAttribute('open');
    expect(screen.getAllByRole('button', { name: 'لم أشاهده' }).length).toBeGreaterThan(0);
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

// ── AUDIT_2026-09-05 M6 / M8 ──────────────────────────────────────────────────

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('RankScreen — submit guards (M6)', () => {
  it('submits once for a double-click, with one idempotency key', async () => {
    const user = userEvent.setup();
    const inFlight = deferred<Record<string, never>>();
    mockApi.rankTriad.mockReturnValue(inFlight.promise);
    renderRank();
    await waitFor(() => screen.getByText('رأس ممحاة'));

    await user.dblClick(screen.getByRole('button', { name: 'حفظ الترتيب' }));

    expect(mockApi.rankTriad).toHaveBeenCalledTimes(1);
    await act(async () => {
      inFlight.resolve({});
      await inFlight.promise;
    });
    await waitFor(() => expect(mockApi.getCurrentTriad).toHaveBeenCalledTimes(2));
  });

  // The Idempotency-Key is minted per loaded triad, not per attempt: a retry
  // after a timeout must carry the key the first attempt carried, so the
  // backend replays that result (ADR-15) instead of refusing a new key.
  it('retries a failed submit with the same idempotency key', async () => {
    const user = userEvent.setup();
    mockApi.rankTriad.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({});
    renderRank();
    await waitFor(() => screen.getByText('رأس ممحاة'));

    await user.click(screen.getByRole('button', { name: 'حفظ الترتيب' }));
    await screen.findByText('تعذّر تحميل الثلاثية.');
    await user.click(screen.getByRole('button', { name: 'حفظ الترتيب' }));

    await waitFor(() => expect(mockApi.rankTriad).toHaveBeenCalledTimes(2));
    const [first, second] = mockApi.rankTriad.mock.calls;
    expect(first[0]).toBe('triad-1');
    expect(second[0]).toBe('triad-1');
    expect(first[2]).toMatch(/^[0-9a-f-]{36}$/);
    expect(second[2]).toBe(first[2]);
  });
});

describe('RankScreen — stale load guard (M8)', () => {
  it("ignores the previous profile's triad when it arrives after a profile switch", async () => {
    const late = deferred<typeof TRIAD_READY>();
    const TRIAD_P2 = {
      ...TRIAD_READY,
      id: 'triad-p2',
      profileId: 'p2',
      titleIds: ['t4', 't5', 't6'],
      displayOrder: ['t4', 't5', 't6'],
      items: [
        { id: 't4', titleEn: 'Alien', titleAr: 'الكائن الفضائي', releaseYear: 1979, genres: ['Sci-Fi'] },
        { id: 't5', titleEn: 'Heat', titleAr: 'هيت', releaseYear: 1995, genres: ['Crime'] },
        { id: 't6', titleEn: 'Ran', titleAr: 'ران', releaseYear: 1985, genres: ['Drama'] },
      ],
    };
    mockApi.getCurrentTriad.mockImplementation((profileId: string) =>
      profileId === 'p1' ? late.promise : Promise.resolve(TRIAD_P2),
    );

    const { rerender } = render(<RankScreen lang="ar" profileId="p1" />);
    rerender(<RankScreen lang="ar" profileId="p2" />);
    await screen.findByText('الكائن الفضائي');

    // p1's response lands after p2's: it must not replace what p2 showed.
    await act(async () => {
      late.resolve(TRIAD_READY);
      await late.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByText('رأس ممحاة')).toBeNull();
    expect(screen.getByText('الكائن الفضائي')).toBeInTheDocument();
  });
});

// ADR-108: the live round of 2026-09-05 showed ten completed rounds to a
// profile the backend counted as having one piece of evidence -- the screen
// was adding repeats to learning rounds and incrementing its own tally on
// save. It now shows what the server counted, and asks for the films that
// would make the next round a new one.
describe('RankScreen — rounds are the server count', () => {
  it('shows learning rounds and names the repeats separately', async () => {
    mockApi.getReadiness.mockResolvedValue(readiness({ learningRounds: 4, verificationRounds: 6, watchedTitles: 3 }));
    renderRank();

    await waitFor(() => expect(screen.getByText(/جولاتك المكتملة: 4/)).toBeInTheDocument());
    expect(screen.getByText(/جولات تكرار/)).toBeInTheDocument();
  });

  it('asks progressively for more films while the watched set makes only repeats', async () => {
    mockApi.getReadiness.mockResolvedValue(readiness({ learningRounds: 1, watchedTitles: 3 }));
    renderRank();

    await waitFor(() => expect(screen.getByText(/سجّل فيلمين آخرين/)).toBeInTheDocument());
  });

  it('does not ask for more once the watched set is large enough', async () => {
    mockApi.getReadiness.mockResolvedValue(readiness({ learningRounds: 1, watchedTitles: 9 }));
    renderRank();

    await waitFor(() => expect(screen.getByText(/جولاتك المكتملة: 1/)).toBeInTheDocument());
    expect(screen.queryByText(/سجّل فيلمين آخرين/)).toBeNull();
  });
});
