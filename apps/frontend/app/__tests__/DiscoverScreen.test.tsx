import '../../jest-dom-vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscoverScreen, type DiscoverViewState } from '../components/DiscoverScreen';
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
  mockApi.listTitles.mockReset();
});

describe('DiscoverScreen', () => {
  it('restores the search and genre after opening a film and mounting the catalogue again', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    mockApi.listTitles.mockResolvedValue({ items: [{ ...title('a', 'العراب'), genres: ['Crime'] }, { ...title('b', 'أنورا'), genres: ['Drama'] }], total: 2 });
    const initialViewState: DiscoverViewState = { query: 'Dune', browseAll: false, genre: null };
    const first = render(<DiscoverScreen lang="ar" profileId="p1" onOpenTitle={open} initialViewState={initialViewState} />);
    await user.click(await screen.findByRole('button', { name: 'جريمة' }));
    await user.click(screen.getByRole('button', { name: 'العراب' }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), null, { query: 'Dune', browseAll: false, genre: 'Crime', pagesLoaded: 1 });
    const saved = open.mock.calls[0][2] as DiscoverViewState;
    first.unmount();
    render(<DiscoverScreen lang="ar" profileId="p1" initialViewState={saved} />);
    expect((await screen.findByRole('searchbox') as HTMLInputElement).value).toBe('Dune');
    expect(await screen.findByRole('button', { name: 'جريمة' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'شاهدت «أنورا»' })).toBeNull();
  });

  it('re-reads all loaded pages before restoring a genre that only appears on page two', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const crime = { ...title('a', 'العراب'), genres: ['Crime'] };
    const drama = { ...title('b', 'أنورا'), genres: ['Drama'] };
    mockApi.listTitles.mockImplementation((_query: string, page: number) => Promise.resolve({ items: [page === 1 ? crime : drama], total: 60 }));
    const first = render(<DiscoverScreen lang="ar" profileId="p1" onOpenTitle={open} initialViewState={{ query: '', browseAll: true, genre: null }} />);
    await user.click(await screen.findByRole('button', { name: 'عرض المزيد' }));
    await user.click(await screen.findByRole('button', { name: 'دراما' }));
    await user.click(screen.getByRole('button', { name: 'أنورا' }));
    const saved = open.mock.calls[0][2] as DiscoverViewState;
    expect(saved).toEqual({ query: '', browseAll: true, genre: 'Drama', pagesLoaded: 2 });
    first.unmount();

    let finishSecondPage!: (result: { items: Title[]; total: number }) => void;
    const secondPage = new Promise<{ items: Title[]; total: number }>((resolve) => { finishSecondPage = resolve; });
    mockApi.listTitles.mockReset().mockImplementation((_query: string, page: number) => page === 2
      ? secondPage
      : Promise.resolve({ items: [page === 1 ? crime : { ...drama, id: 'c', titleAr: 'فيلم إضافي' }], total: 60 }));
    render(<DiscoverScreen lang="ar" profileId="p1" initialViewState={saved} />);
    await waitFor(() => expect(mockApi.listTitles).toHaveBeenCalledWith('', 2, 20));
    expect(mockApi.listTitles).toHaveBeenCalledWith('', 1, 20);
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('لا نتائج. جرّب اسمًا آخر أو الاسم بلغة أخرى.')).toBeNull();
    await act(async () => finishSecondPage({ items: [{ ...drama, titleAr: 'أنورا المحدث' }], total: 60 }));
    expect(await screen.findByRole('button', { name: 'شاهدت «أنورا المحدث»' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'دراما' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'شاهدت «العراب»' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'شاهدت «أنورا»' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'عرض المزيد' }));
    expect(mockApi.listTitles).toHaveBeenLastCalledWith('', 3, 20);
    expect(await screen.findByRole('button', { name: 'شاهدت «فيلم إضافي»' })).toBeInTheDocument();
  });

  it('invalidates a pending multi-page restoration when starting a new search', async () => {
    const user = userEvent.setup();
    let finishRestore!: (result: { items: Title[]; total: number }) => void;
    const restore = new Promise<{ items: Title[]; total: number }>((resolve) => { finishRestore = resolve; });
    mockApi.listTitles.mockImplementation((query: string) => query === 'old'
      ? restore
      : Promise.resolve({ items: [title('new', 'الكثيب')], total: 1 }));
    render(<DiscoverScreen lang="ar" profileId="p1" initialViewState={{ query: 'old', browseAll: false, genre: 'Drama', pagesLoaded: 2 }} />);
    await waitFor(() => expect(mockApi.listTitles).toHaveBeenCalledWith('old', 2, 20));
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'Dune');
    expect(await screen.findByRole('button', { name: 'شاهدت «الكثيب»' })).toBeInTheDocument();
    expect(mockApi.listTitles).toHaveBeenLastCalledWith('Dune', 1, 20);
    expect(mockApi.listTitles).not.toHaveBeenCalledWith('Dune', 2, 20);
    await act(async () => finishRestore({ items: [{ ...title('old', 'نتيجة قديمة'), genres: ['Drama'] }], total: 60 }));
    expect(screen.getByRole('button', { name: 'شاهدت «الكثيب»' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'شاهدت «نتيجة قديمة»' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'عرض المزيد' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)('ignores an old load-more request that %ss after a new search starts', async (outcome) => {
    const user = userEvent.setup();
    let finishOld!: (result: { items: Title[]; total: number }) => void;
    let failOld!: (error: Error) => void;
    let finishSearch!: (result: { items: Title[]; total: number }) => void;
    const oldPage = new Promise<{ items: Title[]; total: number }>((resolve, reject) => { finishOld = resolve; failOld = reject; });
    const nextSearch = new Promise<{ items: Title[]; total: number }>((resolve) => { finishSearch = resolve; });
    mockApi.listTitles.mockImplementation((query: string, page: number) => query === 'Dune'
      ? nextSearch
      : page === 2 ? oldPage : Promise.resolve({ items: [title('a', 'العراب')], total: 3 }));
    render(<DiscoverScreen lang="ar" profileId="p1" />);
    await screen.findByRole('button', { name: 'شاهدت «العراب»' });
    await user.click(await screen.findByRole('button', { name: 'تصفّح الكتالوج كاملًا' }));
    await user.click(await screen.findByRole('button', { name: 'عرض المزيد' }));
    await user.type(screen.getByRole('searchbox'), 'Dune');
    await waitFor(() => expect(mockApi.listTitles).toHaveBeenLastCalledWith('Dune', 1, 20));
    await act(async () => {
      if (outcome === 'resolve') finishOld({ items: [title('old', 'نتيجة قديمة')], total: 3 });
      else failOld(new Error('old page failed'));
    });
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: 'شاهدت «نتيجة قديمة»' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => finishSearch({ items: [title('dune', 'الكثيب')], total: 1 }));
    expect(await screen.findByRole('button', { name: 'شاهدت «الكثيب»' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'عرض المزيد' })).toBeNull();
  });

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
