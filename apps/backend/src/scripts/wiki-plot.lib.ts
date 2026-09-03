/**
 * Pure plot-section helpers for Wikipedia extracts, the same rules
 * `fetch-catalog.ts` applies to the English plot (kept there as a private copy
 * because that script cannot be imported from); exported here so the Arabic
 * evidence pass (`fetch-evidence-ar.ts`) reads the Arabic plot section by the
 * identical rule and the unit tests pin it.
 */

export const PLOT_MAX_CHARS = 3000;

export const PLOT_HEADINGS: Record<string, string[]> = {
  en: ['Plot', 'Plot summary', 'Synopsis', 'Premise', 'Story', 'Storyline', 'Summary'],
  ar: ['القصة', 'قصة الفيلم', 'الحبكة', 'ملخص القصة', 'الملخص', 'أحداث الفيلم', 'القصة والأحداث', 'ملخص', 'الأحداث'],
};

/** The text of the first top-level section whose heading is one of `headings`; sub-section headings stay inline. */
export function extractSection(extract: string, headings: string[]): string | null {
  const lines = extract.split('\n');
  const wanted = new Set(headings.map((heading) => heading.toLowerCase()));
  let collecting = false;
  const buffer: string[] = [];
  for (const line of lines) {
    const heading = /^==\s*([^=].*?)\s*==$/.exec(line.trim());
    if (heading) {
      if (collecting) {
        break;
      }
      collecting = wanted.has(heading[1].toLowerCase());
      continue;
    }
    if (collecting) {
      buffer.push(line.replace(/^=+\s*|\s*=+$/g, ''));
    }
  }
  const text = buffer.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > 0 ? text : null;
}

/** Cut at `max` characters, stepping back to the last sentence end when one lies past the halfway point. */
export function capAtSentence(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('؟ '), cut.lastIndexOf('! '));
  return (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim();
}

export interface EvidenceAr {
  plotSummaryAr: string | null;
  plotSourceAr: string | null;
}

/** The Arabic plot section of an article extract as fixture evidence, or nulls when the article has none. */
export function arabicPlotEvidence(articleTitle: string, extract: string | null): EvidenceAr {
  const section = extract ? extractSection(extract, PLOT_HEADINGS.ar) : null;
  return section
    ? { plotSummaryAr: capAtSentence(section, PLOT_MAX_CHARS), plotSourceAr: `wikipedia:ar:${articleTitle}` }
    : { plotSummaryAr: null, plotSourceAr: null };
}
