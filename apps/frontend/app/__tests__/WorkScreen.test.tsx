import '../../jest-dom-vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
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
