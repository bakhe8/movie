import { describe, expect, it } from 'vitest';
import { LEGAL, type Lang, type LegalDocument } from '../legal/content';

const languages: Lang[] = ['ar', 'en'];

function allText(document: LegalDocument): string {
  return [
    document.draftNotice,
    document.intro,
    ...document.sections.flatMap((section) => [section.head, ...(section.paragraphs ?? []), ...(section.items ?? [])]),
  ].join(' ');
}

describe('legal disclosure copy', () => {
  it.each(languages)('removes stale draft and unbuilt-rights claims in %s', (lang) => {
    const copy = `${allText(LEGAL.terms[lang])} ${allText(LEGAL.privacy[lang])}`;

    expect(LEGAL.terms[lang].updated).toBe('2026-09-05');
    expect(LEGAL.privacy[lang].updated).toBe('2026-09-05');
    expect(copy).not.toContain('بانتظار المراجعة القانونية');
    expect(copy).not.toContain('موعودتان لم تُبنيا بعد');
    expect(copy).not.toContain('موعود، لم يُبنَ بعد');
    expect(copy).not.toContain('pending legal review');
    expect(copy).not.toContain('promised features not built yet');
    expect(copy).not.toContain('promised, not built yet');
  });

  it.each(languages)('states that export and cancellable deletion are available in %s', (lang) => {
    const rightsHeading = lang === 'ar' ? 'حقوقك' : 'Your rights';
    const rights = LEGAL.privacy[lang].sections.find((section) => section.head === rightsHeading)?.items?.join(' ') ?? '';

    expect(rights).toContain('JSON');
    expect(rights).toContain(lang === 'ar' ? 'متاحان الآن' : 'available now');
    expect(rights).toContain(lang === 'ar' ? 'مهلة أمان' : 'safety period');
    expect(rights).toContain(lang === 'ar' ? 'إلغاء الطلب' : 'cancel until');
  });
});
