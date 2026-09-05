import '../../jest-dom-vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkCard } from '../components/WorkCard';
import type { Recommendation, Title } from '../lib/api';

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

  it('says the unknowns once each, as hollow chips rather than sentences', () => {
    const { container } = card();
    const hollow = [...container.querySelectorAll('[class*="hollow"]')].map((el) => el.textContent);

    expect(hollow).toContain('غير معروف بعد');
    expect(container.querySelectorAll('[class*="strip"]')).toHaveLength(1);
  });
});
