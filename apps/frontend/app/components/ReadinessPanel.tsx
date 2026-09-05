'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type CapabilityReadiness, type ProfileReadiness, type ReadinessAction, type ReadinessReason, type ReadinessStatus } from '../lib/api';
import { formatDate } from '../lib/format';
import styles from './ReadinessPanel.module.css';

type Lang = 'ar' | 'en';

/**
 * The four capabilities of `GET /profiles/:id/readiness` (ADR-103,
 * remediation brief §5.1), on screen for the first time. The contract was
 * built to end a specific complaint: ten ranking rounds and one
 * undifferentiated "still learning", with no way to tell whether the ranking
 * of your own watched films was ready, whether a taste profile existed,
 * whether suggestions lacked a model or merely lacked candidates, or whether
 * anyone even knows where a film can be watched.
 *
 * So the panel says all four separately, and for each one: what state it is
 * in, why, and what -- if anything -- it needs from you. `status`, `reason`
 * and `action` are stable codes; every word here is the client's, and an
 * unknown code renders as nothing rather than as a raw code or a guess (a
 * newer backend must never leak `insufficient_triads` onto the screen).
 */
const CAPABILITY_ORDER = ['ordinalModel', 'semanticProfile', 'recommendation', 'availability'] as const;
type CapabilityKey = (typeof CAPABILITY_ORDER)[number];

const copy: Record<Lang, {
  heading: string;
  loading: string;
  failed: string;
  since: (date: string) => string;
  version: (version: string) => string;
  capability: Record<CapabilityKey, { name: string; what: string }>;
  status: Record<ReadinessStatus, string>;
  reason: Record<NonNullable<ReadinessReason>, string>;
  action: Record<NonNullable<ReadinessAction>, string>;
}> = {
  ar: {
    heading: 'ما الجاهز الآن',
    loading: 'جارٍ القراءة…',
    failed: 'تعذّرت قراءة حالة الجاهزية. ما تراه في بقية الصفحة صحيح.',
    since: (date) => `منذ ${date}`,
    version: (version) => `النموذج ${version}`,
    capability: {
      ordinalModel: { name: 'ترتيب أفلامك', what: 'ترتيب ما شاهدته أنت من الأفضل إلى الأقل بالنسبة لذوقك.' },
      semanticProfile: { name: 'ملامح ذوقك', what: 'ميولك عبر محاور الإيقاع والحكاية والنبرة.' },
      recommendation: { name: 'اقتراح أفلام جديدة', what: 'أفلام لم تشاهدها بعد، مرتّبة بذوقك.' },
      availability: { name: 'أين تشاهده', what: 'المنصّات التي يتوفّر عليها الفيلم في سوقك.' },
    },
    status: {
      not_ready: 'غير جاهز',
      eligible: 'جاهز للبدء',
      queued: 'في الطابور',
      processing: 'قيد العمل',
      ready: 'جاهز',
      failed: 'فشل',
      stale: 'يحتاج تحديثاً',
    },
    reason: {
      model_service_disabled: 'خدمة النموذج غير مفعّلة على هذا الخادم؛ إعداد تشغيلي لا شأن لك به.',
      processing_paused: 'المعالجة موقوفة بطلبك في إعدادات الخصوصية.',
      insufficient_triads: 'لم تكتمل جولات ترتيب كافية بعد.',
      insufficient_fingerprint_coverage: 'الأفلام التي رتّبتها لم تُنشر بصماتها بعد.',
      insufficient_eligible_candidates: 'لا توجد أفلام جديدة كافية خارج ما شاهدته.',
      model_service_error: 'تعذّر على خدمة النموذج إتمام التدريب.',
      fingerprint_schema_changed: 'تغيّرت أبعاد البصمة بعد آخر تدريب؛ التدريب التالي يستبدل النموذج.',
      no_availability_data_source: 'لا مصدر بيانات للتوفّر بعد: لا نعرف أين يُشاهد، ولا ندّعي أنه غير متاح.',
    },
    action: {
      rank_more_triads: 'المطلوب منك: جولة ترتيب أخرى.',
      watch_more_titles: 'المطلوب منك: سجّل أفلاماً شاهدتها.',
      request_training: 'المطلوب منك: اطلب التدريب من الزر أدناه.',
      resume_processing: 'المطلوب منك: استأنف المعالجة من إعدادات الخصوصية.',
      retry: 'المطلوب منك: أعد المحاولة من الزر أدناه.',
    },
  },
  en: {
    heading: "What's ready now",
    loading: 'Reading…',
    failed: 'Could not read readiness. The rest of this page is still accurate.',
    since: (date) => `since ${date}`,
    version: (version) => `model ${version}`,
    capability: {
      ordinalModel: { name: 'Ranking your own films', what: 'The films you have watched, ordered by your taste.' },
      semanticProfile: { name: 'Your taste profile', what: 'Your tendencies across pacing, narrative and tone.' },
      recommendation: { name: 'Suggesting new films', what: 'Films you have not watched, ordered by your taste.' },
      availability: { name: 'Where to watch it', what: 'The platforms carrying a film in your market.' },
    },
    status: {
      not_ready: 'Not ready',
      eligible: 'Ready to start',
      queued: 'Queued',
      processing: 'Working',
      ready: 'Ready',
      failed: 'Failed',
      stale: 'Needs a refresh',
    },
    reason: {
      model_service_disabled: 'The model service is not enabled on this server; an operator setting, not something you can act on.',
      processing_paused: 'Processing is paused at your request, in privacy settings.',
      insufficient_triads: 'Not enough ranking rounds completed yet.',
      insufficient_fingerprint_coverage: 'The films you ranked have no published fingerprint yet.',
      insufficient_eligible_candidates: 'Not enough unwatched films to choose from.',
      model_service_error: 'The model service could not finish the training run.',
      fingerprint_schema_changed: 'The fingerprint dimensions changed after the last run; the next one replaces the model.',
      no_availability_data_source: 'No availability source yet: we do not know where it plays, and we will not claim it is unavailable.',
    },
    action: {
      rank_more_triads: 'What is needed from you: one more ranking round.',
      watch_more_titles: 'What is needed from you: mark some films you have watched.',
      request_training: 'What is needed from you: ask for training with the button below.',
      resume_processing: 'What is needed from you: resume processing in privacy settings.',
      retry: 'What is needed from you: try again with the button below.',
    },
  },
};

// `ready` and the two in-flight states read as progress; everything else is
// an absence with a reason. Only three tones, so the panel never looks like
// an alarm over a state the user cannot act on.
const TONE: Record<ReadinessStatus, 'ready' | 'working' | 'absent'> = {
  ready: 'ready',
  queued: 'working',
  processing: 'working',
  eligible: 'absent',
  not_ready: 'absent',
  failed: 'absent',
  stale: 'absent',
};

export function ReadinessPanel({ profileId, lang, refreshKey = 0 }: { profileId: string | null; lang: Lang; refreshKey?: number }) {
  const t = copy[lang];
  const [readiness, setReadiness] = useState<ProfileReadiness | null>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');

  const load = useCallback(
    async (stillMounted: () => boolean) => {
      if (!profileId) return;
      setState('loading');
      try {
        const result = await api.getReadiness(profileId);
        if (!stillMounted()) return;
        setReadiness(result);
        setState('loaded');
      } catch {
        // An honest failure line, never a silent empty panel: this endpoint
        // is the one that explains absences, so its own absence is one too.
        if (stillMounted()) setState('failed');
      }
    },
    [profileId],
  );

  useEffect(() => {
    let cancelled = false;
    // load()'s setState calls run inside its own async body, not
    // synchronously in this effect -- the "fetch on mount" pattern
    // ConsentsPanel and RankScreen already use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load, refreshKey]);

  if (!profileId) return null;

  return (
    <div className={styles.panel}>
      <h4 className={styles.heading}>{t.heading}</h4>
      {state === 'loading' && <p className={styles.muted}>{t.loading}</p>}
      {state === 'failed' && (
        <p className={styles.muted} role="status">
          {t.failed}
        </p>
      )}
      {state === 'loaded' && readiness && (
        <ul className={styles.list}>
          {CAPABILITY_ORDER.map((key) => (
            <Capability key={key} capabilityKey={key} value={readiness[key]} lang={lang} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Capability({ capabilityKey, value, lang }: { capabilityKey: CapabilityKey; value: CapabilityReadiness; lang: Lang }) {
  const t = copy[lang];
  const names = t.capability[capabilityKey];
  // A code this build has no words for comes from a newer backend: it is
  // dropped, never printed raw.
  const status = t.status[value.status];
  const reason = value.reason ? t.reason[value.reason] : null;
  const action = value.action ? t.action[value.action] : null;
  const meta = [
    value.publishedAt ? t.since(formatDate(value.publishedAt, lang)) : null,
    value.modelVersion ? t.version(value.modelVersion) : null,
  ].filter(Boolean);

  return (
    <li className={styles.item}>
      <div className={styles.line}>
        <span className={styles.name}>{names.name}</span>
        <span className={`${styles.badge} ${styles[TONE[value.status]]}`}>{status ?? value.status}</span>
      </div>
      <p className={styles.what}>{names.what}</p>
      {reason && <p className={styles.reason}>{reason}</p>}
      {action && <p className={styles.action}>{action}</p>}
      {meta.length > 0 && <p className={styles.meta}>{meta.join(' · ')}</p>}
    </li>
  );
}
