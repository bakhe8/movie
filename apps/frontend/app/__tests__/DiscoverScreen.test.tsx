import '../../jest-dom-vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
