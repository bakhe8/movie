import '../../jest-dom-vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListScreen } from '../components/ListScreen';
import { api } from '../lib/api';
import { todayLocal } from '../lib/format';

vi.mock('../lib/api', () => ({
  api: {
    getWatchedTitles: vi.fn(),
    getWatchlist: vi.fn(),
    getLibraryRanking: vi.fn(),
    setTitleState: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const mocks = vi.mocked(api);
const film = { id: 'arrival', internalId: 'arrival', titleEn: 'Arrival', titleAr: 'الوافد', releaseYear: 2016, description: null, genres: ['Drama'], posterUrl: null };
const listed = { id: 'state-arrival', profileId: 'p1', titleId: film.id, state: 'watchlist' as const, watchedAt: null, watchedOn: null, triadEligible: true, importedRating: null, ratingSource: null, notes: null, updatedAt: '2026-09-05T12:00:00Z', title: film };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWatchedTitles.mockResolvedValue([]);
  mocks.getWatchlist.mockResolvedValue([listed]);
  mocks.getLibraryRanking.mockResolvedValue([]);
  mocks.setTitleState.mockResolvedValue({ ...listed, state: 'watched', watchedOn: todayLocal() });
});

describe('visual library navigation', () => {
  it('opens saved and watched titles with their actual state without changing the library', async () => {
    const user = userEvent.setup();
    const onOpenCatalogTitle = vi.fn();
    const watchedFilm = { ...film, id: 'contact', titleEn: 'Contact' };
    mocks.getWatchedTitles.mockResolvedValue([{ ...listed, id: 'state-contact', titleId: watchedFilm.id, title: watchedFilm, state: 'watched', watchedOn: '2026-09-04' }]);
    render(<ListScreen lang="en" profileId="p1" onOpenCatalogTitle={onOpenCatalogTitle} />);

    await user.click(await screen.findByRole('button', { name: 'Open film: Arrival' }));
    expect(onOpenCatalogTitle).toHaveBeenLastCalledWith(film, 'watchlist');
    await user.click(screen.getByRole('button', { name: 'Arrival' }));
    expect(onOpenCatalogTitle).toHaveBeenLastCalledWith(film, 'watchlist');
    await user.click(screen.getByRole('tab', { name: /Watch history/ }));
    await user.click(screen.getByRole('button', { name: 'Open film: Contact' }));
    expect(onOpenCatalogTitle).toHaveBeenLastCalledWith(watchedFilm, 'watched');
    await user.click(screen.getByRole('button', { name: 'Contact' }));
    expect(onOpenCatalogTitle).toHaveBeenLastCalledWith(watchedFilm, 'watched');
    expect(mocks.setTitleState).not.toHaveBeenCalled();
    expect(mocks.getWatchlist).toHaveBeenCalledTimes(1);
    expect(mocks.getWatchedTitles).toHaveBeenCalledTimes(1);
  });

  it('shows one library section at a time and preserves the saved collection across tabs', async () => {
    const user = userEvent.setup();
    render(<ListScreen lang="en" profileId="p1" />);
    expect(await screen.findByRole('heading', { name: 'Arrival' })).toBeVisible();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);

    await user.click(screen.getByRole('tab', { name: /Watch history/ }));
    expect(screen.getByText('No watched films recorded yet.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Arrival' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: /To watch later/ }));
    expect(screen.getByRole('heading', { name: 'Arrival' })).toBeVisible();
    expect(mocks.getWatchlist).toHaveBeenCalledTimes(1);
  });

  it('moves a watched film into history in place, with its actual local watch date and visible feedback', async () => {
    const user = userEvent.setup();
    render(<ListScreen lang="en" profileId="p1" />);
    await user.click(await screen.findByRole('button', { name: 'Watched it' }));

    await waitFor(() => expect(mocks.setTitleState).toHaveBeenCalledWith('p1', film.id, { state: 'watched', watchedOn: todayLocal() }));
    expect(await screen.findByRole('status')).toHaveTextContent('“Arrival” is marked as watched.');
    await user.click(screen.getByRole('tab', { name: /Watch history/ }));
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Arrival' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Diary' })).toBeVisible();
    expect(mocks.getWatchedTitles).toHaveBeenCalledTimes(1);
  });

  it('supports directional keyboard navigation in Arabic', async () => {
    const user = userEvent.setup();
    render(<ListScreen lang="ar" profileId="p1" />);
    const first = await screen.findByRole('tab', { name: /للمشاهدة لاحقًا/ });
    first.focus();
    await user.keyboard('{ArrowLeft}');
    const ranking = screen.getByRole('tab', { name: /ترتيبك الشخصي/ });
    expect(ranking).toHaveFocus();
    expect(ranking).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-selected', 'true');
  });
});
