import '../../jest-dom-vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkScreen } from '../components/WorkScreen';
import type { Title } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    // The page re-reads the title for the fields a card does not carry.
    getTitle: vi.fn(),
    getWatchedTitles: vi.fn().mockResolvedValue([]),
    getWatchlist: vi.fn().mockResolvedValue([]),
    setTitleState: vi.fn().mockResolvedValue({}),
  },
  ApiError: class ApiError extends Error {},
}));

import { api } from '../lib/api';
const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// UX_AUDIT_MOBILE_2026-09-05 P0 #6 and P1 #9: the page opened on an English
// Wikipedia paragraph, called itself "صفحة العمل", spoke of a "بصمة", and put
// the only two actions after everything else.
const title: Title = {
  id: 't1',
  internalId: 'i1',
  titleEn: 'Divine Intervention',
  titleAr: 'يد إلهية',
  description: 'Divine Intervention is a 2002 surreal black comedy film by Elia Suleiman.',
  releaseYear: 2002,
  genres: null,
  posterUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getTitle.mockResolvedValue(title);
  mockApi.getWatchedTitles.mockResolvedValue([]);
  mockApi.getWatchlist.mockResolvedValue([]);
  mockApi.setTitleState.mockResolvedValue({});
});

function page() {
  return render(<WorkScreen lang="ar" profileId="p1" title={title} context={{ kind: 'none' }} onBack={() => {}} />);
}

describe('WorkScreen', () => {
  it('speaks the reader’s vocabulary, not the team’s', async () => {
    page();
    await screen.findByRole('heading', { name: 'يد إلهية' });

    expect(screen.queryByText('صفحة العمل')).toBeNull();
    expect(screen.queryByText(/بصمة/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'سمات العمل' })).toBeInTheDocument();
  });

  it('folds a synopsis written in another language behind its own name', async () => {
    const { container } = page();
    await screen.findByRole('heading', { name: 'يد إلهية' });

    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details?.querySelector('summary')?.textContent).toBe('الملخص (بالإنجليزية)');
    expect(details?.textContent).toContain('surreal black comedy');
  });

  it('folds a local-language synopsis too, leaving the image and actions first', async () => {
    const arabic = { ...title, description: 'فيلم كوميديا سوداء من إخراج إيليا سليمان.' };
    mockApi.getTitle.mockResolvedValue(arabic);
    render(
      <WorkScreen
        lang="ar"
        profileId="p1"
        title={arabic}
        context={{ kind: 'none' }}
        onBack={() => {}}
      />,
    );
    await screen.findByRole('heading', { name: 'يد إلهية' });

    expect(screen.getByText(/إخراج إيليا سليمان/)).toBeInTheDocument();
    const synopsis = document.querySelector('details');
    expect(synopsis).not.toHaveAttribute('open');
    expect(synopsis?.querySelector('summary')).toHaveTextContent('عن الفيلم');
  });

  it('puts what the reader can do above the reference material', async () => {
    const { container } = page();
    await screen.findByRole('heading', { name: 'يد إلهية' });

    const headings = [...container.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings.indexOf('حالته عندك')).toBeLessThan(headings.indexOf('الجودة العامة'));
  });

  it('keeps a confirmed watch when the two older initial reads settle separately', async () => {
    const user = userEvent.setup();
    const watched = deferred<never[]>();
    const watchlist = deferred<never[]>();
    mockApi.getWatchedTitles.mockReturnValueOnce(watched.promise);
    mockApi.getWatchlist.mockReturnValueOnce(watchlist.promise);
    page();
    await waitFor(() => expect(mockApi.getWatchlist).toHaveBeenCalledWith('p1'));
    await user.click(screen.getByRole('button', { name: 'شاهدته' }));
    expect(mockApi.setTitleState).toHaveBeenCalledWith('p1', 't1', expect.objectContaining({ state: 'watched' }));
    expect(screen.getByRole('button', { name: 'تراجع' })).toBeEnabled();
    await act(async () => watched.resolve([]));
    expect(screen.getByRole('button', { name: 'تراجع' })).toBeEnabled();
    await act(async () => watchlist.resolve([]));
    expect(screen.getByRole('button', { name: 'تراجع' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'شاهدته' })).toBeNull();
  });

  it('does not reinstate a watched state from an old snapshot after a confirmed undo', async () => {
    const user = userEvent.setup();
    const watched = deferred<Array<{ titleId: string; state: string }>>();
    mockApi.getWatchedTitles.mockReturnValueOnce(watched.promise);
    render(<WorkScreen lang="ar" profileId="p1" title={title} context={{ kind: 'none' }} initialState="watched" onBack={() => {}} />);
    await waitFor(() => expect(mockApi.getWatchedTitles).toHaveBeenCalledWith('p1'));
    await user.click(screen.getByRole('button', { name: 'تراجع' }));
    expect(screen.getByRole('button', { name: 'شاهدته' })).toBeEnabled();
    await act(async () => watched.resolve([{ titleId: 't1', state: 'watched' }]));
    expect(screen.getByRole('button', { name: 'شاهدته' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'تراجع' })).toBeNull();
  });

  it('releases a failed action for retry while keeping its failure tone after a language change', async () => {
    const user = userEvent.setup();
    const action = deferred<object>();
    mockApi.setTitleState.mockReturnValueOnce(action.promise);
    const { rerender } = page();
    await user.click(screen.getByRole('button', { name: 'شاهدته' }));
    expect(screen.getByRole('button', { name: 'شاهدته' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'لاحقًا' })).toBeDisabled();
    await act(async () => action.reject(new Error('failed')));
    expect(screen.getByRole('alert')).toHaveTextContent('تعذّر الحفظ');
    expect(screen.getByRole('button', { name: 'شاهدته' })).toBeEnabled();
    rerender(<WorkScreen lang="en" profileId="p1" title={title} context={{ kind: 'none' }} onBack={() => {}} />);
    expect(screen.getByRole('alert').closest('[data-tone]')).toHaveAttribute('data-tone', 'error');
    await user.click(screen.getByRole('button', { name: 'Watched it' }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(mockApi.setTitleState).toHaveBeenCalledTimes(2);
  });

  it('does not apply a previous profile action or initial snapshot after the profile changes', async () => {
    const user = userEvent.setup();
    const save = deferred<object>();
    const watched = deferred<Array<{ titleId: string; state: string }>>();
    mockApi.getWatchedTitles.mockReturnValueOnce(watched.promise);
    mockApi.setTitleState.mockReturnValueOnce(save.promise);
    const { rerender } = page();
    await user.click(screen.getByRole('button', { name: 'شاهدته' }));
    rerender(<WorkScreen lang="ar" profileId="p2" title={title} context={{ kind: 'none' }} onBack={() => {}} />);
    await waitFor(() => expect(mockApi.getWatchlist).toHaveBeenLastCalledWith('p2'));
    expect(screen.getByRole('button', { name: 'شاهدته' })).toBeEnabled();
    await act(async () => { watched.resolve([{ titleId: 't1', state: 'watched' }]); save.resolve({}); });
    expect(screen.getByRole('button', { name: 'شاهدته' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'تراجع' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// POSTERS-MULTI P5, direction ب (approved 2026-09-06): the film's other
// posters are a strip of thumbnails under the actions; a tap swaps the cover
// and the small poster together, and nothing is saved.
describe('WorkScreen poster set', () => {
  const tmdb = { name: 'TMDB', attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.' };
  const posters = ['/one.jpg', '/two.jpg', '/three.jpg'].map((path) => ({ posterUrl: `https://image.tmdb.org/t/p/w342${path}`, posterSource: tmdb }));

  function open(detail: Title) {
    mockApi.getTitle.mockResolvedValue(detail);
    return render(<WorkScreen lang="ar" profileId="p1" title={detail} context={{ kind: 'none' }} onBack={() => {}} />);
  }
  const activePoster = (container: HTMLElement) => container.querySelector('[data-poster-layer][data-active] img')?.getAttribute('src');
  const activeCover = (container: HTMLElement) =>
    (container.querySelector('[data-cover-layer][data-active]') as HTMLElement | null)?.style.getPropertyValue('--layer-image');

  it('opens on the first poster and swaps the cover and the small poster together on a tap', async () => {
    const user = userEvent.setup();
    const { container } = open({ ...title, posterUrl: posters[0].posterUrl, posterSource: tmdb, posters });
    await screen.findByRole('heading', { name: 'يد إلهية' });

    const strip = screen.getByRole('group', { name: 'بوسترات الفيلم' });
    const thumbs = within(strip).getAllByRole('button');
    expect(thumbs).toHaveLength(3);
    expect(thumbs[0]).toHaveAttribute('aria-pressed', 'true');
    expect(activePoster(container)).toBe(posters[0].posterUrl);
    expect(activeCover(container)).toBe(`url("${posters[0].posterUrl}")`);

    await user.click(thumbs[1]);
    expect(thumbs[1]).toHaveAttribute('aria-pressed', 'true');
    expect(thumbs[0]).toHaveAttribute('aria-pressed', 'false');
    expect(activePoster(container)).toBe(posters[1].posterUrl);
    expect(activeCover(container)).toBe(`url("${posters[1].posterUrl}")`);
    // Every layer stays in the tree: the swap is a crossfade, not a reload.
    expect(container.querySelectorAll('[data-poster-layer]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-cover-layer]')).toHaveLength(3);
    // The strip sits inside the header, before the synopsis it shares the row with.
    const synopsis = container.querySelector('details');
    expect(synopsis).not.toBeNull();
    expect(strip.compareDocumentPosition(synopsis!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no strip for a single-poster film and still paints that poster', async () => {
    const { container } = open({ ...title, posterUrl: posters[0].posterUrl, posterSource: tmdb, posters: posters.slice(0, 1) });
    await screen.findByRole('heading', { name: 'يد إلهية' });

    expect(screen.queryByRole('group', { name: 'بوسترات الفيلم' })).toBeNull();
    expect(activePoster(container)).toBe(posters[0].posterUrl);
    expect(activeCover(container)).toBe(`url("${posters[0].posterUrl}")`);
  });

  it('renders a response from before the poster set exactly as before', async () => {
    const { container } = open({ ...title, posterUrl: posters[0].posterUrl, posterSource: tmdb });
    await screen.findByRole('heading', { name: 'يد إلهية' });

    expect(screen.queryByRole('group', { name: 'بوسترات الفيلم' })).toBeNull();
    expect(container.querySelectorAll('[data-poster-layer], [data-cover-layer]')).toHaveLength(0);
    const cover = [...container.querySelectorAll('div')].find((element) => element.style.getPropertyValue('--hero-image'));
    expect(cover?.style.getPropertyValue('--hero-image')).toBe(`url("${posters[0].posterUrl}")`);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(posters[0].posterUrl);
  });

  it('credits the source of every poster in the set, each once', async () => {
    const other = { name: 'Wikimedia Commons', attribution: 'CC BY-SA 4.0' };
    open({ ...title, posterUrl: posters[0].posterUrl, posterSource: tmdb, posters: [posters[0], { ...posters[1], posterSource: other }] });
    await screen.findByRole('heading', { name: 'يد إلهية' });

    // The names line lists each source once, in the order they were met;
    // TMDB's own attribution sentence mentions its name again, by design.
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toContain('TMDB · Wikimedia Commons');
    expect(footer.textContent).not.toContain('TMDB · TMDB');
  });
});
