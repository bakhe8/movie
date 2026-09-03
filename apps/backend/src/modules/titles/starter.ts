// The starter list (blueprint §4.2 "اختيار سريع من عناوين معروفة ومتنوعة",
// SPECIFICATION §5.1 step 3 "suggest a diverse starter list"): a
// deterministic, genre-diverse sample of the catalogue for a user who has
// marked nothing yet. Pure function so it is testable without a database.
//
// Diversity rule: group by primary genre (the first listed), take the groups
// largest-first, order each group newest-first, then pick round-robin across
// groups until `limit`. No randomness -- the same catalogue always yields
// the same list, and no taste signal is involved (nothing is known yet).

interface StarterCandidate {
  titleEn: string;
  releaseYear: number | null;
  genres: string[] | null;
}

const UNKNOWN_GENRE = 'unknown';

export function diversify<T extends StarterCandidate>(titles: readonly T[], limit: number): T[] {
  if (limit <= 0 || titles.length === 0) {
    return [];
  }

  const groups = new Map<string, T[]>();
  for (const title of titles) {
    const key = title.genres?.[0]?.trim() || UNKNOWN_GENRE;
    const group = groups.get(key);
    if (group) group.push(title);
    else groups.set(key, [title]);
  }

  const ordered = [...groups.values()]
    .map((group) =>
      [...group].sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0) || a.titleEn.localeCompare(b.titleEn)),
    )
    .sort((a, b) => b.length - a.length || a[0].titleEn.localeCompare(b[0].titleEn));

  const picks: T[] = [];
  for (let round = 0; picks.length < limit; round += 1) {
    let added = false;
    for (const group of ordered) {
      const candidate = group[round];
      if (!candidate) continue;
      picks.push(candidate);
      added = true;
      if (picks.length === limit) break;
    }
    if (!added) break;
  }
  return picks;
}

// Arabic search folding: hamza forms of alef, taa marbuta and alef maqsura
// are typed interchangeably, and tashkeel/tatweel never matter for search.
// Applied to the query here and to the column in SQL (same character map,
// see TitlesService) so «احلام» finds «أحلام» and «مدرسه» finds «مدرسة».
export const ARABIC_FOLD_FROM = 'أإآةى';
export const ARABIC_FOLD_TO = 'اااهي';

export function foldArabic(text: string): string {
  const stripped = text.replace(/[ً-ْـ]/g, '');
  let folded = '';
  for (const char of stripped) {
    const index = ARABIC_FOLD_FROM.indexOf(char);
    folded += index === -1 ? char : ARABIC_FOLD_TO[index];
  }
  return folded;
}
