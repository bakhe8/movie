import '../../jest-dom-vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('leaves an Arabic synopsis where the reader can just read it', async () => {
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
    expect(document.querySelector('details')).toBeNull();
  });

  it('puts what the reader can do above the reference material', async () => {
    const { container } = page();
    await screen.findByRole('heading', { name: 'يد إلهية' });

    const headings = [...container.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings.indexOf('حالته عندك')).toBeLessThan(headings.indexOf('الجودة العامة'));
  });
});
