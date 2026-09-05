import '../../jest-dom-vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkCard } from '../components/WorkCard';
import type { Recommendation, Title } from '../lib/api';
import type { PublicQuality } from '../public-quality/types';

// UX_AUDIT_MOBILE_2026-09-05: the card was measured at 357-411px with a 56px
// poster, four labelled cells, and a confidence sentence that repeated on
// every one of the home screen's thirteen cards. ADR-111 turns the values
// into one strip, puts the poster first at the 96px floor, and makes the
// poster a second way into the work page (the 22px title text was the only
// one).
const title: Title = {
  id: 't1',
  internalId: 'i1',
  titleEn: 'Divine Intervention',
  titleAr: 'يد إلهية',
  description: null,
  releaseYear: 2002,
  genres: null,
  posterUrl: null,
};

const recommendation: Recommendation = {
  recommendationId: 'r1',
  title,
  personalFitScore: 0.9,
  publicQualityScore: 6.6,
  watchabilityScore: null,
  availability: 'unknown',
  confidenceBand: 'inconclusive',
  fingerprintCoverage: 1,
  track: 'safe',
  modelVersion: 'test',
  reason: { features: [], evidenceSource: 'individual' },
};

const productionRecommendation = {
  ...recommendation,
  publicQuality: {
    value: 8.1,
    votes: 250000,
    sources: [{ source: 'imdb', value: 8.1, scale: '1-10', votes: 250000, capturedAt: '2026-08-14T09:00:00.000Z', attribution: null }],
  } satisfies PublicQuality,
  watchability: { available: true, providers: [{ name: 'MUBI', market: 'SA' }] },
};

function card(onOpen?: () => void) {
  return render(
    <WorkCard lang="ar" position={1} count={7} recommendation={recommendation} listed={false} busy={false} onOpen={onOpen} />,
  );
}

describe('WorkCard', () => {
  it('opens the work page from the poster as well as the title', () => {
    const onOpen = vi.fn();
    const { container } = card(onOpen);

    const poster = container.querySelector('[class*="posterButton"]') as HTMLButtonElement | null;
    expect(poster).not.toBeNull();
    poster!.click();

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps the poster out of the tab order, since the title button is the same destination', () => {
    const { container } = card(() => {});
    const poster = container.querySelector('[class*="posterButton"]');

    expect(poster).toHaveAttribute('tabindex', '-1');
    expect(poster).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'يد إلهية' })).toBeInTheDocument();
  });

  it('gives the poster the size a decision is made from, not a thumbnail', () => {
    const { container } = card();
    const poster = container.querySelector('[class*="poster"][class*="md"], [class*="md"][class*="poster"]');

    expect(poster).not.toBeNull();
  });

  it('shows the confidence as one word and leaves its sentence to assistive tech', () => {
    const { container } = card();

    // The band word is visible; the sentence that used to sit under every
    // card is present but not drawn (the screen says it once instead).
    expect(container.querySelector('[class*="band"]')?.textContent).toBe('غير محسوم');
    const hidden = [...container.querySelectorAll('[class*="srOnly"]')].map((el) => el.textContent ?? '');
    expect(hidden.some((text) => text.includes('لا توجد إشارة كافية بعد'))).toBe(true);
  });

  // Owner's addendum 3 (2026-09-05): where the expression is already
  // understood, the symbol carries it. A star beside a number is the rating
  // idiom every catalogue uses, so "out of ten" stops being spelled out --
  // and the number stays a number, because the number is the information.
  it('shows a rating as a star and a number, without spelling out the scale', () => {
    const { container } = card();

    expect(container.querySelector('[class*="rating"] svg')).not.toBeNull();
    expect(container.querySelector('[class*="num"]')?.textContent).toBe('6.6');
    expect(container.textContent).not.toContain('من 10');
    // The cell is still named for anyone listening rather than looking.
    expect(container.querySelector('[class*="srOnly"]')?.textContent).toBe('الملاءمة الشخصية');
  });

  it('says the unknowns once each, as hollow chips rather than sentences', () => {
    const { container } = card();
    const hollow = [...container.querySelectorAll('[class*="hollow"]')].map((el) => el.textContent);

    expect(hollow).toContain('غير معروف بعد');
    expect(container.querySelectorAll('[class*="strip"]')).toHaveLength(1);
  });

  it('keeps a compact shelf tile to poster, title and personal fit', () => {
    const { container } = render(
      <WorkCard
        lang="ar"
        position={1}
        count={7}
        compact
        recommendation={productionRecommendation}
        listed={false}
        busy={false}
        onOpen={() => {}}
        onAddToList={vi.fn()}
        onMarkWatched={vi.fn()}
        onNotRelevant={vi.fn()}
      />,
    );

    expect(container.querySelector('[class*="poster"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'يد إلهية' })).toBeInTheDocument();
    expect(container.querySelector('[class*="fitRow"]')).not.toBeNull();
    expect(container.querySelector('[class*="metaRow"]')).toBeNull();
    expect(container.querySelector('img[alt="IMDb"]')).toBeNull();
    expect(container).not.toHaveTextContent('250,000');
    expect(container).not.toHaveTextContent('MUBI');
    expect(container).not.toHaveTextContent('غير محسوم');
    expect(screen.queryByRole('button', { name: 'أضف إلى قائمتي' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'شاهدته' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ليس اقتراحًا مناسبًا' })).toBeNull();
  });

  it('restores production quality and availability on the full card', () => {
    const { container } = render(
      <WorkCard
        lang="ar"
        position={1}
        count={7}
        recommendation={productionRecommendation}
        listed={false}
        busy={false}
        onAddToList={vi.fn()}
        onMarkWatched={vi.fn()}
        onNotRelevant={vi.fn()}
      />,
    );

    expect(container.querySelector('img[alt="IMDb"]')).not.toBeNull();
    expect(container).toHaveTextContent('250,000');
    expect(container).toHaveTextContent('MUBI · SA');
    expect(container).toHaveTextContent('غير محسوم');
    expect(screen.getByRole('button', { name: 'أضف إلى قائمتي' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'شاهدته' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ليس اقتراحًا مناسبًا' })).toBeInTheDocument();
  });
});
