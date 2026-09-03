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

// The four visible confidence bands (blueprint §9.3; ADR-33). Confidence is
// always one of these, rendered as its label and copy -- never a number, a
// percentage or a bar with a number on it, on any surface that shows a
// prediction. The copy follows §9.3's suggested phrasing for each band; the
// `likely` line names the band's meaning (evidence inside a narrow context)
// without claiming a specific context the model does not report yet.
export const CONFIDENCE_BAND_COPY = {
  ar: {
    inconclusive: { label: 'غير محسوم', copy: 'لا توجد إشارة كافية بعد.' },
    initial: { label: 'أولي', copy: 'بدأنا نلاحظ ذوقك، لكننا ما زلنا نتعلم.' },
    likely: { label: 'محتمل', copy: 'يظهر هذا الميل في سياق محدد من اختياراتك.' },
    strong: { label: 'قوي', copy: 'هذا نمط ثابت نسبيًا في اختياراتك.' },
  },
  en: {
    inconclusive: { label: 'Inconclusive', copy: 'Not enough signal yet.' },
    initial: { label: 'Initial', copy: 'We are starting to notice your taste, but still learning.' },
    likely: { label: 'Likely', copy: 'This tendency shows in a specific part of your choices.' },
    strong: { label: 'Strong', copy: 'A fairly stable pattern in your choices.' },
  },
} as const;

// How each fingerprint dimension reads in a recommendation reason
// (blueprint §9.4: abstract descriptions, no plot, no sensitive traits;
// FINGERPRINT_SCHEMA.md §2 for the dimensions). `higher` is the phrase for a
// title that has more of the dimension than the pool, `lower` for less.
export const FEATURE_REASON_COPY = {
  ar: {
    pacing: { higher: 'إيقاع سريع', lower: 'إيقاع هادئ' },
    rhythmVariance: { higher: 'إيقاع متقلّب', lower: 'إيقاع ثابت' },
    ambiguity: { higher: 'غموض مقصود', lower: 'وضوح في السرد' },
    psychologicalDepth: { higher: 'عمق نفسي', lower: 'خفّة نفسية' },
    warmth: { higher: 'دفء', lower: 'برود مقصود' },
    darkness: { higher: 'قتامة', lower: 'إشراق' },
    linearity: { higher: 'سرد خطّي', lower: 'سرد غير خطّي' },
    dialogueDensity: { higher: 'حوار كثيف', lower: 'حوار قليل' },
    actionIntensity: { higher: 'حركة كثيفة', lower: 'حركة قليلة' },
    plotComplexity: { higher: 'حبكة معقدة', lower: 'حبكة بسيطة' },
    visualComplexity: { higher: 'بصريات غنية', lower: 'بصريات بسيطة' },
    soundscapeComplexity: { higher: 'صوت غني', lower: 'صوت بسيط' },
    colorSaturation: { higher: 'ألوان مشبعة', lower: 'ألوان باهتة' },
  },
  en: {
    pacing: { higher: 'fast pacing', lower: 'calm pacing' },
    rhythmVariance: { higher: 'shifting rhythm', lower: 'steady rhythm' },
    ambiguity: { higher: 'deliberate ambiguity', lower: 'narrative clarity' },
    psychologicalDepth: { higher: 'psychological depth', lower: 'psychological lightness' },
    warmth: { higher: 'warmth', lower: 'deliberate coolness' },
    darkness: { higher: 'darkness', lower: 'brightness' },
    linearity: { higher: 'linear storytelling', lower: 'non-linear storytelling' },
    dialogueDensity: { higher: 'dense dialogue', lower: 'sparse dialogue' },
    actionIntensity: { higher: 'heavy action', lower: 'little action' },
    plotComplexity: { higher: 'a complex plot', lower: 'a simple plot' },
    visualComplexity: { higher: 'rich visuals', lower: 'plain visuals' },
    soundscapeComplexity: { higher: 'a rich soundscape', lower: 'a plain soundscape' },
    colorSaturation: { higher: 'saturated colour', lower: 'muted colour' },
  },
} as const;

// The three recommendation tracks (blueprint §4.4, ADR-8): the name the user
// sees and what each track is for, in the blueprint's own words.
export const TRACK_COPY = {
  ar: {
    safe: { name: 'اختيار آمن', purpose: 'أعلى ملاءمة ضمن منطقة يعرفها النموذج.' },
    discovery: { name: 'اكتشاف محسوب', purpose: 'عمل يعبر جنرًا أو لغة عبر رابط غير بديهي مع ذوقك.' },
    outside_usual: { name: 'خارج المعتاد', purpose: 'استكشاف بمخاطرة أعلى لمنع الفقاعة، مع حدود الثقة بوضوح.' },
  },
  en: {
    safe: { name: 'Safe pick', purpose: 'Highest fit inside the region the model already knows.' },
    discovery: { name: 'Measured discovery', purpose: 'A film that crosses a genre or language through a non-obvious link to your taste.' },
    outside_usual: { name: 'Outside the usual', purpose: 'Higher-risk exploration to prevent a bubble, with the limits of confidence stated plainly.' },
  },
} as const;
