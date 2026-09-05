// The catalogue's genres are a closed, English vocabulary: `mapGenres()` in
// apps/backend/src/scripts/fetch-catalog.ts folds every Wikidata sub-genre
// label into one of the keys below and drops anything it cannot fold, so a
// genre reaching the screen is always one of these. They were rendered
// verbatim until now -- English chips on an Arabic page (remediation brief
// P1-05 / L10N-01: 0 of 300 titles had an Arabic genre).
//
// The dictionary lives on the client on purpose: the genre key is data, its
// wording is copy, and copy is translated where the rest of the copy is
// (the same split as SOURCE_LABEL in app/public-quality/types.ts). Nothing
// is written back to the catalogue.
type Lang = 'ar' | 'en';

export const GENRE_LABEL: Record<string, Record<Lang, string>> = {
  Action: { ar: 'أكشن', en: 'Action' },
  Adventure: { ar: 'مغامرة', en: 'Adventure' },
  Animation: { ar: 'رسوم متحركة', en: 'Animation' },
  Biography: { ar: 'سيرة ذاتية', en: 'Biography' },
  Comedy: { ar: 'كوميديا', en: 'Comedy' },
  'Coming-of-Age': { ar: 'نضج وبلوغ', en: 'Coming-of-Age' },
  Crime: { ar: 'جريمة', en: 'Crime' },
  Disaster: { ar: 'كوارث', en: 'Disaster' },
  Documentary: { ar: 'وثائقي', en: 'Documentary' },
  Drama: { ar: 'دراما', en: 'Drama' },
  Epic: { ar: 'ملحمي', en: 'Epic' },
  Family: { ar: 'عائلي', en: 'Family' },
  Fantasy: { ar: 'فانتازيا', en: 'Fantasy' },
  'Film Noir': { ar: 'فيلم نوار', en: 'Film Noir' },
  History: { ar: 'تاريخي', en: 'History' },
  Horror: { ar: 'رعب', en: 'Horror' },
  Music: { ar: 'موسيقي', en: 'Music' },
  Musical: { ar: 'استعراضي', en: 'Musical' },
  Mystery: { ar: 'غموض', en: 'Mystery' },
  Political: { ar: 'سياسي', en: 'Political' },
  'Road Movie': { ar: 'فيلم طريق', en: 'Road Movie' },
  Romance: { ar: 'رومانسي', en: 'Romance' },
  'Science Fiction': { ar: 'خيال علمي', en: 'Science Fiction' },
  Sport: { ar: 'رياضي', en: 'Sport' },
  Spy: { ar: 'تجسس', en: 'Spy' },
  Superhero: { ar: 'أبطال خارقون', en: 'Superhero' },
  Thriller: { ar: 'إثارة', en: 'Thriller' },
  War: { ar: 'حرب', en: 'War' },
  Western: { ar: 'ويسترن', en: 'Western' },
};

// A key this build has no words for (the catalogue gained a genre before the
// client did) falls back to the key itself: an English chip is worse than an
// Arabic one, and better than a blank or a dropped genre.
export function genreLabel(genre: string, lang: Lang): string {
  return GENRE_LABEL[genre]?.[lang] ?? genre;
}
