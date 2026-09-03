// Fixed product copy whose wording is a product decision, not a UI detail.
//
// The triad instruction pins the meaning of the answer to stable personal
// liking — not artistic quality, not tonight's mood (blueprint §2.4 principle
// #4, §4.3; SPECIFICATION.md §2 row 4 and §5.2). Change it only through the
// blueprint; both languages must say the same thing.
export const TRIAD_INSTRUCTION = {
  ar: 'رتّب هذه الأفلام حسب إعجابك الشخصي، من الأكثر إلى الأقل.',
  en: 'Rank these films by how much you personally liked them, most to least.',
} as const;
