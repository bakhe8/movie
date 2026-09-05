import '../../jest-dom-vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscoverScreen } from '../components/DiscoverScreen';
import type { Title } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getWatchedTitles: vi.fn().mockResolvedValue([]),
    getWatchlist: vi.fn().mockResolvedValue([]),
    getStarterTitles: vi.fn(),
    listTitles: vi.fn(),
    setTitleState: vi.fn().mockResolvedValue({}),
  },
  ApiError: class ApiError extends Error {},
}));

import { api } from '../lib/api';
const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

// UX_AUDIT_MOBILE_2026-09-05 P1 #16 and the owner's interaction addendum:
// "ماذا شاهدت؟" is a visual question, and it was being asked with text cards
// carrying English Wikipedia paragraphs. It is a poster grid now: one tap
// marks, the same tap again takes it back, and nothing hides behind a press.
const title = (id: string, ar: string): Title => ({
  id,
  internalId: `i-${id}`,
  titleEn: 'The Godfather',
  titleAr: ar,
  description: 'The Godfather is a 1972 American epic gangster film directed by Francis Ford Coppola.',
  releaseYear: 1972,
  genres: ['crime'],
  posterUrl: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getWatchedTitles.mockResolvedValue([]);
  mockApi.getWatchlist.mockResolvedValue([]);
  mockApi.getStarterTitles.mockResolvedValue([title('a', 'العراب'), title('b', 'أنورا')]);
  mockApi.setTitleState.mockResolvedValue({});
});

describe('DiscoverScreen', () => {
  it('clears the displayed-genre filter when changing catalogue scope', async () => {
    const user = userEvent.setup();
    mockApi.getStarterTitles.mockResolvedValue([{ ...title('a', 'العراب'), genres: ['Crime'] }, { ...title('b', 'أنورا'), genres: ['Drama'] }]);
    mockApi.listTitles.mockResolvedValue({ items: [{ ...title('c', 'الكثيب'), genres: ['Science Fiction'] }], total: 1 });
    render(<DiscoverScreen lang="ar" profileId="p1" />);
    await user.click(await screen.findByRole('button', { name: 'جريمة' }));
    expect(screen.queryByRole('button', { name: 'شاهدت «أنورا»' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'تصفّح الكتالوج كاملًا' }));
    expect(await screen.findByRole('button', { name: 'شاهدت «الكثيب»' })).toBeInTheDocument();
    expect(mockApi.setTitleState).not.toHaveBeenCalled();
  });

  it('keeps independently saving films disabled until each request settles', async () => {
    const user = userEvent.setup();
    let finishA!: () => void;
    let finishB!: () => void;
    mockApi.setTitleState.mockImplementation((_profile: string, id: string) => new Promise<void>((resolve) => { if (id === 'a') finishA = resolve; else finishB = resolve; }));
    render(<DiscoverScreen lang="ar" profileId="p1" />);
    const first = await screen.findByRole('button', { name: 'شاهدت «العراب»' });
    const second = screen.getByRole('button', { name: 'شاهدت «أنورا»' });
    await user.click(first);
    await user.click(second);
    expect(first).toBeDisabled();
    expect(second).toBeDisabled();
    await act(async () => finishA());
    expect(second).toBeDisabled();
    await act(async () => finishB());
    expect(mockApi.setTitleState).toHaveBeenCalledTimes(2);
  });

  it('announces failed saving as an error and keeps the film unmarked', async () => {
    const user = userEvent.setup();
    mockApi.setTitleState.mockRejectedValue(new Error('offline'));
    render(<DiscoverScreen lang="ar" profileId="p1" />);
    await user.click(await screen.findByRole('button', { name: 'شاهدت «العراب»' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('تعذّر الحفظ');
    expect(screen.getByRole('button', { name: 'شاهدت «العراب»' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('asks with posters, not with paragraphs', async () => {
    render(<DiscoverScreen lang="ar" profileId="p1" />);
    await screen.findByRole('button', { name: 'شاهدت «العراب»' });

    expect(screen.queryByText(/epic gangster film/)).toBeNull();
    expect(screen.getByRole('button', { name: 'شاهدت «أنورا»' })).toBeInTheDocument();
  });

  it('marks with one tap and takes it back with the same one', async () => {
    const user = userEvent.setup();
    render(<DiscoverScreen lang="ar" profileId="p1" />);

    const tile = await screen.findByRole('button', { name: 'شاهدت «العراب»' });
    expect(tile).toHaveAttribute('aria-pressed', 'false');

    await user.click(tile);

    const marked = await screen.findByRole('button', { name: /مسجَّل كمُشاهَد/ });
    expect(marked).toHaveAttribute('aria-pressed', 'true');
    expect(mockApi.setTitleState).toHaveBeenLastCalledWith('p1', 'a', expect.objectContaining({ state: 'watched' }));

    await user.click(marked);

    expect(mockApi.setTitleState).toHaveBeenLastCalledWith('p1', 'a', { state: 'not_watched' });
  });

  it('gives "later" its own named target instead of a hidden gesture', async () => {
    const user = userEvent.setup();
    render(<DiscoverScreen lang="ar" profileId="p1" />);

    const later = await screen.findByRole('button', { name: 'احفظ «العراب» لاحقًا' });
    await user.click(later);

    expect(mockApi.setTitleState).toHaveBeenLastCalledWith('p1', 'a', { state: 'watchlist' });
  });

  it('keeps the film’s own page one tap away, from the title', async () => {
    const onOpenTitle = vi.fn();
    const user = userEvent.setup();
    render(<DiscoverScreen lang="ar" profileId="p1" onOpenTitle={onOpenTitle} />);

    await user.click(await screen.findByRole('button', { name: 'العراب' }));

    expect(onOpenTitle).toHaveBeenCalledTimes(1);
  });
});
