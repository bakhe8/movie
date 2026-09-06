import '../../jest-dom-vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkCard } from '../components/WorkCard';
import type { ConfidenceBand, Recommendation, Title } from '../lib/api';
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

  it('keeps a compact shelf visual and offers immediate save and watched actions', () => {
    const onAddToList = vi.fn();
    const onMarkWatched = vi.fn();
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
        onAddToList={onAddToList}
        onMarkWatched={onMarkWatched}
        onNotRelevant={vi.fn()}
      />,
    );

    expect(container.querySelector('[class*="poster"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'يد إلهية' })).toBeInTheDocument();
    expect(container.querySelector('[class*="fitRow"]')).not.toBeNull();
    expect(container.querySelector('[class*="metaRow"]')).toBeNull();
    expect(container.querySelector('summary img[alt="IMDb"]')).not.toBeNull();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByText(/250,000/)).not.toBeVisible();
    expect(container).not.toHaveTextContent('MUBI');
    expect(container).not.toHaveTextContent('غير محسوم');
    screen.getByRole('button', { name: 'أضف إلى قائمتي' }).click();
    screen.getByRole('button', { name: 'شاهدته' }).click();
    expect(onAddToList).toHaveBeenCalledTimes(1);
    expect(onMarkWatched).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'ليس اقتراحًا مناسبًا' })).toBeNull();
  });

  it('shows the actual IMDb source score and discloses its dated reading and exact attribution', async () => {
    const user = userEvent.setup();
    const source = { ...productionRecommendation.publicQuality.sources[0], value: 6.4, attribution: 'Exact IMDb source attribution.' };
    const measuredRecommendation: Recommendation & { publicQuality: PublicQuality } = {
      ...productionRecommendation,
      publicQuality: { value: 9.9, votes: null, sources: [source] },
    };
    const { container } = render(<WorkCard lang="ar" position={1} count={7} compact listed={false} busy={false}
      recommendation={measuredRecommendation} />);
    const details = container.querySelector('details') as HTMLDetailsElement;
    const summary = details.querySelector('summary') as HTMLElement;
    expect(summary).toHaveTextContent('6.4');
    expect(summary).not.toHaveTextContent('9.9');
    expect(summary.querySelector('img')).toHaveAttribute('src', '/brand/imdb.svg');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText(source.attribution)).not.toBeVisible();
    await user.click(summary);
    expect(details).toHaveAttribute('open');
    expect(screen.getByText(source.attribution)).toBeVisible();
    expect(screen.getByText(/250,000 تصويت/)).toBeVisible();
    expect(screen.getByText(/بتاريخ/)).toBeVisible();
  });

  it('never puts an IMDb mark on an unattributed, different-source, or unknown score', () => {
    const qualities: Array<PublicQuality | undefined> = [
      undefined,
      { ...productionRecommendation.publicQuality, sources: [{ ...productionRecommendation.publicQuality.sources[0], source: 'other' }] },
      { ...productionRecommendation.publicQuality, sources: [{ ...productionRecommendation.publicQuality.sources[0], value: null }] },
    ];
    const { container, rerender } = render(<WorkCard lang="ar" position={1} count={7} compact listed={false} busy={false} recommendation={recommendation} />);
    for (const publicQuality of qualities) {
      const sourcedRecommendation: Recommendation & { publicQuality?: PublicQuality } = { ...productionRecommendation, publicQuality };
      rerender(<WorkCard lang="ar" position={1} count={7} compact listed={false} busy={false} recommendation={sourcedRecommendation} />);
      expect(container.querySelector('img[alt="IMDb"]')).toBeNull();
      expect(container.querySelector('details')).toBeNull();
    }
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
  // The bar used to take the confidence band as a class as well: `likely`
  // dimmed the fill to 0.75, `initial` to 0.5, and `inconclusive` emptied it
  // to a dashed outline. On one shelf a card reading "عالية" drew a hollow
  // bar beside a "متوسطة" card with two solid segments, and read as the
  // weaker of the two (owner report 2026-09-06). Fit alone draws the bar now,
  // and confidence keeps its own word.
  it('draws the same fit bar at every confidence band', () => {
    const bands: ConfidenceBand[] = ['inconclusive', 'initial', 'likely', 'strong'];
    const bars = bands.map((confidenceBand) => {
      const { container, unmount } = render(
        <WorkCard lang="ar" position={1} count={7} recommendation={{ ...recommendation, confidenceBand }} listed={false} busy={false} />,
      );
      const meter = container.querySelector('[class*="meter"]') as HTMLElement;
      const bar = { className: meter.className, lit: meter.querySelectorAll('i[class]').length };
      unmount();
      return bar;
    });

    expect(bars.map((bar) => bar.lit)).toEqual([3, 3, 3, 3]);
    expect(new Set(bars.map((bar) => bar.className)).size).toBe(1);
    expect(bars[0].className).not.toMatch(/likely|initial|inconclusive|strong/);
  });

  it('keeps a better fit ahead of a weaker one whatever the confidence says', () => {
    const lit = (position: number, confidenceBand: ConfidenceBand) => {
      const { container, unmount } = render(
        <WorkCard lang="ar" position={position} count={7} recommendation={{ ...recommendation, confidenceBand }} listed={false} busy={false} />,
      );
      const segments = container.querySelectorAll('[class*="meter"] i[class]').length;
      unmount();
      return segments;
    };

    // The pair from the report: high fit at the weakest band must still draw
    // more of the bar than medium fit at the strongest.
    expect(lit(1, 'inconclusive')).toBeGreaterThan(lit(4, 'strong'));
  });
});
