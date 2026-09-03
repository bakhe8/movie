import { describe, expect, it } from 'vitest';

import { PLOT_HEADINGS, PLOT_MAX_CHARS, arabicPlotEvidence, capAtSentence, extractSection } from './wiki-plot.lib';

const ARTICLE = ['باب الحديد فيلم مصري.', '', '== القصة ==', 'قناوي بائع صحف أعرج يعمل في محطة القطار.', '=== النهاية ===', 'ينتهي الفيلم بالقبض عليه.', '', '== الإنتاج ==', 'صُوّر الفيلم في القاهرة.'].join('\n');

describe('extractSection', () => {
  it('returns the first wanted top-level section with its sub-sections inline, and stops at the next heading', () => {
    expect(extractSection(ARTICLE, PLOT_HEADINGS.ar)).toBe('قناوي بائع صحف أعرج يعمل في محطة القطار.\nالنهاية\nينتهي الفيلم بالقبض عليه.');
    expect(extractSection(ARTICLE, PLOT_HEADINGS.en)).toBeNull();
    expect(extractSection('== Plot ==\n\n\n\nText.', PLOT_HEADINGS.en)).toBe('Text.');
  });
});

describe('capAtSentence', () => {
  it('keeps short text, cuts long text at the last sentence end past the halfway point', () => {
    expect(capAtSentence('short', 10)).toBe('short');
    expect(capAtSentence('One sentence. Two sentence. Three', 22)).toBe('One sentence.');
    expect(capAtSentence('جملة أولى طويلة جداً؟ ثانية', 25)).toBe('جملة أولى طويلة جداً؟');
    const noStops = 'a'.repeat(40);
    expect(capAtSentence(noStops, 10)).toBe('a'.repeat(10));
  });
});

describe('arabicPlotEvidence', () => {
  it('names the article as the source and caps the section', () => {
    const evidence = arabicPlotEvidence('باب الحديد (فيلم)', ARTICLE);
    expect(evidence.plotSourceAr).toBe('wikipedia:ar:باب الحديد (فيلم)');
    expect(evidence.plotSummaryAr).toContain('قناوي');
    const long = `== القصة ==\n${'جملة طويلة. '.repeat(600)}`;
    expect(arabicPlotEvidence('x', long).plotSummaryAr!.length).toBeLessThanOrEqual(PLOT_MAX_CHARS);
  });

  it('is null, never a lead or a guess, when the article has no plot section', () => {
    expect(arabicPlotEvidence('x', 'مقدمة فقط.\n== الإنتاج ==\nنص.')).toEqual({ plotSummaryAr: null, plotSourceAr: null });
    expect(arabicPlotEvidence('x', null)).toEqual({ plotSummaryAr: null, plotSourceAr: null });
  });
});
