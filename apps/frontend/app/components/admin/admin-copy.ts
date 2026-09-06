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
  overview: {
    title: 'نظرة عامة',
    blurb: 'أهم أرقام المنصّة خلال فترة زمنية: من يُسجّل، من يُكمل رحلة الذوق، وهل يعود المستخدمون بعد التوصية.',
  },
  operations: {
    title: 'التشغيل',
    blurb: 'العمليات الآلية التي تعمل في الخلفية: تحديث ملفات الذوق، والبريد الصادر للمستخدمين.',
  },
  audit: {
    title: 'سجل العمليات',
    blurb: 'كل إجراء إداري أو نظامي مؤثر، ومن نفّذه، ومتى — للمساءلة والتتبع، للقراءة فقط.',
  },
  titleEdit: {
    title: 'تعديل بيانات فيلم',
    blurb: 'تصحيح بيانات الفيلم الأساسية، وإدارة سجلات حقوق العرض المرتبطة به.',
  },
  users: {
    title: 'الحسابات',
    blurb: 'حسابات المستخدمين: تفعيل أو إيقاف حساب، أو منح صلاحية مسؤول وسحبها.',
  },
  modelRegistration: {
    title: 'تسجيل نماذج التوصية',
    blurb: 'تسجيل إصدار جديد من نظام التوصية، واعتماد الإصدار الذي يُستخدم فعلياً حالياً.',
  },
  jobs: {
    title: 'المهام الآلية',
    blurb: 'المهام الخلفية التي تعمل أو عملت مؤخراً على الكتالوج، وحالتها وتقدّمها.',
  },
  jobsAdmin: {
    title: 'تشغيل مهمة',
    blurb: 'تشغيل مهمة من قائمة محدودة ومعروفة فقط؛ يمكن تجربتها أولاً دون كتابة فعلية (تنفيذ تجريبي).',
  },
  settings: {
    title: 'الإعدادات',
    blurb: 'القيم التي يضبطها النظام تلقائياً، ومصدر كل قيمة ومتى تغيّرت آخر مرة.',
  },
  settingsAdmin: {
    title: 'تعديل إعداد',
    blurb: 'كل تعديل يُعاين قبل النشر، ويُسجَّل بسبب، ويمكن التراجع عنه لاحقاً دون فقدان القيم السابقة.',
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
// value stands in the human-verification workflow. source_records shares
// the same three-value enum for the same reason.
export const REVIEW_STATUS_COPY: Record<string, string> = {
  unreviewed: 'بانتظار المراجعة',
  sampled: 'رُوجعت وصحيحة',
  human_verified: 'صُحِّحت يدوياً',
};

// source_records.licenseStatus / titles.licenseStatus (worst-of across a
// title's rights rows).
export const LICENSE_STATUS_LABELS: Record<string, string> = {
  commercial_allowed: 'تجاري', non_commercial_only: 'غير تجاري', pending_review: 'قيد المراجعة', unknown: 'غير معروف',
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
  // V3-form/cultural/information/rhythm/style families (found live on real
  // titles during ADMIN-W3 verification -- lib/copy.ts's FEATURE_REASON_COPY
  // predates these, so only a neutral label exists here; no higher/lower
  // phrase is claimed for them without an authoritative product meaning.
  'cultural.originalLanguage': 'لغة الإنتاج الأصلية',
  'cultural.productionCountry': 'بلد الإنتاج',
  'information.expositionDirectness': 'مباشرة الشرح',
  'information.knowledgeComplexity': 'تعقيد المعرفة المسبقة المطلوبة',
  'information.subtext': 'عمق المعنى الضمني',
  'narrative.scope': 'اتساع نطاق القصة',
  'rhythm.deliberateness': 'تعمّد الإيقاع',
  'rhythm.setupLength': 'طول التمهيد',
  'rhythm.turningPointDensity': 'كثافة نقاط التحوّل',
  'style.experimentation': 'التجريب الأسلوبي',
  'style.scale': 'حجم الإنتاج',
  'style.stylization': 'التنميط الأسلوبي',
  'tone.playfulness': 'المرح',
  'tone.sentimentality': 'العاطفية المفرطة',
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
// `value` is nullable because the column itself is: NULL means unknown,
// never 0 (BP §11.3) -- always returns null for it rather than guessing.
export function featureValuePhrase(key: string, value: number | null, reasonCopyAr: Record<string, { higher: string; lower: string }>): string | null {
  if (value === null) return null;
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

// ADMIN-W3 (audit_log.action, W0 case B5): raw values are internal event
// names ("admin.model_version.activate") written by many services, not a
// closed enum -- an unmapped one still needs a readable fallback rather
// than a blank cell or the untranslated dotted string alone.
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'admin.user.update': 'تعديل حساب مستخدم',
  'admin.model_version.register': 'تسجيل إصدار نموذج جديد',
  'admin.model_version.activate': 'تفعيل إصدار نموذج',
  'admin.model_version.update': 'تعديل إصدار نموذج',
  'admin.title.update': 'تعديل بيانات فيلم',
  'admin.source_record.create': 'إضافة سجل حقوق',
  'admin.source_record.update': 'تعديل سجل حقوق',
  'admin.content_feature.review': 'مراجعة تحليل فيلم',
  'auth.refresh.reuse_detected': 'رصد إعادة استخدام جلسة مسروقة',
  'auth.logout_all': 'تسجيل خروج من كل الأجهزة',
  'auth.password_reset.requested': 'طلب إعادة تعيين كلمة المرور',
  'auth.password_reset.confirmed': 'تأكيد إعادة تعيين كلمة المرور',
  'privacy.export': 'تصدير بيانات مستخدم',
  'privacy.delete.scheduled': 'جدولة حذف حساب',
  'privacy.delete.executed': 'تنفيذ حذف حساب',
  'privacy.delete.cancelled': 'إلغاء طلب حذف حساب',
  'privacy.pause_all': 'إيقاف مؤقت لكل الملفات',
  'privacy.resume': 'استئناف المعالجة',
  'privacy.reset': 'إعادة ضبط الذوق',
};

// A readable fallback for an action this map does not know yet: replace the
// namespacing dots with a separator that reads as a path, never invent a
// meaning the raw string does not carry.
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action.split('.').join(' › ');
}

export const AUDIT_RESOURCE_LABELS: Record<string, string> = {
  user: 'حساب مستخدم',
  profile: 'ملف ذوق',
  title: 'فيلم',
  source_record: 'سجل حقوق',
  content_feature: 'تحليل فيلم',
  model_version: 'إصدار نموذج',
};

export function auditResourceLabel(resource: string): string {
  return AUDIT_RESOURCE_LABELS[resource] ?? resource;
}

// mail_outbox.kind/status (ADR-97, W0 case B6).
export const MAIL_KIND_LABELS: Record<string, string> = {
  password_reset: 'رابط إعادة تعيين كلمة المرور',
  probe: 'فحص تشغيلي',
};

export const MAIL_STATUS_LABELS: Record<string, string> = {
  pending: 'بانتظار الإرسال',
  delivered: 'أُرسلت',
  dead: 'فشلت نهائياً',
};

// admin/metrics funnel step keys (BP §18.1) -> the plain question each step
// answers, in order.
export const FUNNEL_STEP_LABELS: Record<string, string> = {
  registered: 'أنشأ حساباً',
  onboarded: 'حدّد بلده',
  watched_3: 'سجّل 3 أفلام شاهدها',
  first_triad: 'رتّب أول ثلاثية',
  three_triads: 'أكمل 3 ثلاثيات',
  trained: 'بُني ملف ذوقه',
  shown_result: 'شاهد أول توصية',
  returned: 'عاد لاستخدام المنصّة',
};

// admin/metrics recommendations.outcomes keys -- what a user did after
// seeing a recommendation.
export const RECOMMENDATION_OUTCOME_LABELS: Record<string, string> = {
  clicked: 'نقر على الفيلم',
  saved: 'أضافه لقائمته',
  opened_provider: 'فتح منصة المشاهدة',
  dismissed_not_relevant: 'رفضه كغير مناسب',
  watched: 'شاهده فعلاً',
  ranked_later: 'رتّبه لاحقاً في ثلاثية',
};

// users.role (ADMIN-W4 user-management screen).
export const USER_ROLE_LABELS: Record<'user' | 'admin', string> = {
  user: 'مستخدم',
  admin: 'مسؤول',
};

// The server's own refusal reasons for admin/users writes and source-record
// edits (ADMIN-W4) -- each one is a real guard the service enforces, not a
// generic failure, so the operator sees exactly why the action was blocked
// instead of a bare "فشل الحفظ".
export const ADMIN_ERROR_REASON_LABELS: Record<string, string> = {
  self_change: 'لا يمكن لأي مسؤول تعديل صلاحيته أو حالة حسابه الخاص.',
  last_admin: 'هذا آخر حساب مسؤول نشط؛ لا يمكن إيقافه أو سحب صلاحيته قبل تعيين مسؤول آخر.',
  already_superseded: 'هذا السجل استُبدل بتعديل لاحق؛ حدّث الصفحة للعمل على أحدث نسخة منه.',
  exists: 'هذا الإصدار مسجَّل مسبقاً.',
  admin_required: 'هذا الإجراء يتطلب صلاحية مسؤول.',
};

export function adminErrorReasonLabel(reason: string | undefined, fallback: string): string {
  if (!reason) return fallback;
  return ADMIN_ERROR_REASON_LABELS[reason] ?? fallback;
}

// admin_settings' resolution source (ADMIN-W6, plan §17.3): whether the
// value shown came from an explicit publish, an env var at deploy time, or
// the hardcoded fallback nobody has touched.
export const SETTING_SOURCE_LABELS: Record<string, string> = {
  default: 'القيمة الافتراضية',
  deploy: 'مضبوطة عند النشر',
  control_plane: 'مُعدَّلة يدوياً',
};

// admin_jobs.status (ADMIN-W5, plan §17.2).
export const JOB_STATUS_LABELS: Record<string, string> = {
  queued: 'بانتظار التنفيذ',
  running: 'قيد التنفيذ',
  succeeded: 'انتهت بنجاح',
  failed: 'فشلت',
  cancelled: 'أُلغيت',
};

// source_records fields an admin can add or correct (BP §11.1 rights
// registry) -- form labels, distinct from the raw column names.
export const SOURCE_RECORD_FIELD_LABELS = {
  fieldName: 'الحقل المصدر',
  source: 'مصدر المعلومة',
  value: 'القيمة المسجَّلة',
  license: 'نص الترخيص',
  licenseStatus: 'حالة الترخيص',
  allowsStorage: 'يسمح بالتخزين',
  allowsDerivation: 'يسمح بالاشتقاق (مثل استخراج الخصائص)',
  allowsTraining: 'يسمح باستخدامه في تدريب النموذج',
  attributionRequired: 'تتطلب نسب المصدر عند العرض',
  fallbackPlan: 'خطة بديلة إن سُحب الإذن',
  reviewStatus: 'حالة المراجعة',
} as const;
