// ADMIN-W2 (owner feedback 2026-09-06): the panel must read as plain
// operator language, not internal engineering terms -- "بصمة", "سمات",
// "عينة", "مُهيَّأة" and raw dotted feature keys like `characters.agency`
// meant nothing without knowing the codebase. This file is the one place
// admin screens borrow product wording from; it does not change any
// stored value, only how each one is displayed.

// Section titles and a one-line explanation of what the section is for and
// why it exists, shown at the top of each monitoring/administration screen.
export const ADMIN_SECTION_COPY: Record<string, { title: string; blurb: string }> = {
  catalog: {
    title: 'الكتالوج',
    blurb: 'كل الأفلام في المنصّة، وحالة تحليلها الآلي وحقوق عرضها.',
  },
  reviews: {
    title: 'مراجعة تحليل الأفلام',
    blurb:
      'يحلّل النظام كل فيلم آلياً ليستخرج خصائصه (مثل نبرة القصة أو عمق الشخصيات) ويستخدمها في التوصيات. هذه الصفحة تعرض ما يحتاج تحققاً بشرياً من دقّة ذلك التحليل.',
  },
  models: {
    title: 'أداء نظام التوصيات',
    blurb: 'هل نظام التوصيات يعمل بصحة؟ وما الإصدار المستخدم حالياً لبناء توصيات المستخدمين؟',
  },
  privacy: {
    title: 'الخصوصية',
    blurb: 'طلبات المستخدمين لتصدير بياناتهم أو حذف حسابهم أو إعادة ضبط ذوقهم.',
  },
  review: {
    title: 'مراجعة المحتوى',
    blurb: 'تأكيد أن تحليلاً آلياً لفيلم مطابق للواقع.',
  },
};

// hasFingerprint/hasV2 (docs/API.md `admin/titles`): whether -- and how
// completely -- a title has gone through the automatic analysis that
// recommendations are built on.
export const ANALYSIS_STATUS_COPY = {
  full: 'تحليل كامل',
  basic: 'تحليل أساسي',
  none: 'لم يُحلَّل بعد',
} as const;

export function analysisStatus(hasFingerprint: boolean, hasV2: boolean): keyof typeof ANALYSIS_STATUS_COPY {
  return hasV2 ? 'full' : hasFingerprint ? 'basic' : 'none';
}

// content_features.reviewStatus (docs/SCHEMA.md §1): where one analyzed
// value stands in the human-verification workflow.
export const REVIEW_STATUS_COPY: Record<string, string> = {
  unreviewed: 'بانتظار المراجعة',
  sampled: 'رُوجعت وصحيحة',
  human_verified: 'صُحِّحت يدوياً',
};

// The extracted-value confirmation action (ADR-117 W0 case F4, formerly
// labelled "عينة" -- a QA-sampling term with no meaning outside the
// pipeline). Clicking it means: a person looked at this value and confirms
// it matches the film.
export const CONFIRM_ANALYSIS_LABEL = 'تأكيد صحة التحليل';

// One neutral noun per raw content_features.featureKey, for the column/card
// label admins actually read. Meanings follow the same product dimensions
// as lib/copy.ts's FEATURE_REASON_COPY (consumer-facing reason phrases) --
// kept as a separate map because admin needs neutral nouns for a table
// header, not "higher than pool"/"lower than pool" comparative phrases.
export const FEATURE_KEY_LABELS: Record<string, string> = {
  pacing: 'الإيقاع',
  rhythmVariance: 'تقلّب الإيقاع',
  ambiguity: 'الغموض السردي',
  psychologicalDepth: 'العمق النفسي',
  warmth: 'الدفء العاطفي',
  darkness: 'القتامة',
  linearity: 'خطّية السرد',
  dialogueDensity: 'كثافة الحوار',
  actionIntensity: 'شدة الحركة',
  plotComplexity: 'تعقيد الحبكة',
  visualComplexity: 'التعقيد البصري',
  soundscapeComplexity: 'تعقيد الصوت',
  colorSaturation: 'تشبّع الألوان',
  'narrative.revelation': 'أسلوب الكشف السردي',
  'narrative.perspective': 'زاوية السرد',
  'narrative.unreliability': 'موثوقية الراوي',
  'tone.irony': 'السخرية',
  'tone.unease': 'التوتر',
  'tone.catharsis': 'التفريغ العاطفي',
  'tone.compassion': 'التعاطف',
  'characters.agency': 'استقلالية الشخصيات',
  'characters.moralAmbiguity': 'الغموض الأخلاقي للشخصيات',
  'characters.transformation': 'تحوّل الشخصيات',
  'characters.relationshipCentrality': 'مركزية العلاقات',
  'ending.openness': 'انفتاح النهاية على التأويل',
  'ending.twist': 'مفاجأة النهاية',
  'ending.justice': 'انتصار العدالة في النهاية',
  'ending.optimism': 'تفاؤل النهاية',
};

export function featureKeyLabel(key: string): string {
  return FEATURE_KEY_LABELS[key] ?? key;
}

// higher/lower phrases per key, for turning a bare 0-1 value into something
// an admin can actually check against the film. Reuses lib/copy.ts's
// consumer phrasing where one exists; the four ending.* dimensions are
// spoiler-free empty strings there (SPOILER_DIMENSIONS, correct for
// consumers), so admin -- an internal reviewer who must judge accuracy --
// gets its own plain phrasing for exactly those four.
const ENDING_VALUE_PHRASES: Record<string, { higher: string; lower: string }> = {
  'ending.openness': { higher: 'نهاية مفتوحة للتأويل', lower: 'نهاية محسومة وواضحة' },
  'ending.twist': { higher: 'نهاية فيها مفاجأة', lower: 'نهاية متوقعة' },
  'ending.justice': { higher: 'العدالة تنتصر', lower: 'لا انتصار واضح للعدالة' },
  'ending.optimism': { higher: 'نهاية متفائلة', lower: 'نهاية قاتمة' },
};

// Given a 0-1 content_features.value, the phrase that actually describes
// what the number means for this dimension -- above the pool's midpoint
// reads as "higher", at or below as "lower". Falls back to the bare number
// for a key this map does not know (never invents a claim it cannot back).
export function featureValuePhrase(key: string, value: number, reasonCopyAr: Record<string, { higher: string; lower: string }>): string | null {
  const phrases = ENDING_VALUE_PHRASES[key] ?? reasonCopyAr[key];
  if (!phrases) return null;
  const phrase = value > 0.5 ? phrases.higher : phrases.lower;
  return phrase || null;
}

// model_versions.active / whether a version came from a registered row or
// only from user_model_snapshots (docs/API.md `admin/models`). "مسجَّلة"/
// "غير مسجَّلة" named a database operation, not what it means for the
// product: one version is the one actually serving recommendations, the
// other appeared from real usage but was never made official.
export const MODEL_VERSION_STATUS_COPY = {
  active: 'الإصدار المعتمَد حالياً',
  registeredInactive: 'إصدار مسجَّل غير مفعَّل',
  unregistered: 'ظهر تلقائياً من الاستخدام (غير معتمد)',
} as const;

// admin/readiness's modelService.{configured,reachable} (docs/API.md):
// whether the AI service that trains per-user taste models is set up and
// answering at all.
export const MODEL_SERVICE_STATUS_COPY = {
  notConfigured: 'غير مفعّلة',
  unreachable: 'لا تستجيب',
  reachable: 'تعمل',
} as const;

export function modelServiceStatus(configured: boolean, reachable: boolean): keyof typeof MODEL_SERVICE_STATUS_COPY {
  if (!configured) return 'notConfigured';
  return reachable ? 'reachable' : 'unreachable';
}
