'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, type Recommendation, type UserTitleState } from '../lib/api';

const labels = {
  ar: {
    watchedTitle: 'الأفلام المُشاهَدة',
    empty: 'لم تُسجَّل أفلام مشاهَدة بعد.',
    recsTitle: 'توصياتك',
    recsPending: 'التوصيات غير متاحة بعد -- أكمل جولات ترتيب أكثر ودرّب النموذج.',
    recsEmpty: 'لا توجد توصيات حاليًا -- سجّل مزيدًا من الأفلام أو أكمل جولات ترتيب أكثر.',
    recsError: 'تعذّر تحميل التوصيات. حاول مجددًا لاحقًا.',
    loading: 'جارٍ التحميل…',
  },
  en: {
    watchedTitle: 'Watched films',
    empty: 'No watched films recorded yet.',
    recsTitle: 'Your recommendations',
    recsPending: 'Recommendations are not ready yet -- complete more ranking rounds and train the model.',
    recsEmpty: 'No recommendations right now -- log more films or complete more ranking rounds.',
    recsError: 'Recommendations could not be loaded. Please try again later.',
    loading: 'Loading…',
  },
};

// Why recommendations are not shown. Stored as a status rather than the
// backend's (English) error message so the effect below can stay scoped to
// [profileId] while the rendered text still follows the current language.
type RecsStatus = 'pending' | 'error' | null;

export function ListScreen({ lang, profileId }: { lang: 'ar' | 'en'; profileId: string }) {
  const [watched, setWatched] = useState<UserTitleState[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);
  const [recsStatus, setRecsStatus] = useState<RecsStatus>(null);
  const [loading, setLoading] = useState(true);
  const t = labels[lang];

  useEffect(() => {
    let cancelled = false;
    // Re-affirm the loading state for a real re-fetch (profileId change);
    // redundant with the initial useState(true) on first mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    Promise.all([
      api.getWatchedTitles(profileId),
      api
        .getRecommendations(profileId)
        .then((result) => {
          if (cancelled) return;
          setRecommendations(result);
          setRecsStatus(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setRecommendations(null);
          // 409 is the backend's "no trained preference model yet" answer
          // (RecommendationsService); anything else is a real failure.
          setRecsStatus(err instanceof ApiError && err.status === 409 ? 'pending' : 'error');
        }),
    ]).then(([watchedTitles]) => {
      if (!cancelled) setWatched(watchedTitles);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  if (loading) {
    return <p className="muted">{t.loading}</p>;
  }

  const recsMessage =
    recsStatus === 'error' ? t.recsError : recsStatus === 'pending' ? t.recsPending : t.recsEmpty;

  return (
    <>
      <h2>{t.recsTitle}</h2>
      {recommendations && recommendations.length > 0 ? (
        <div className="results">
          {recommendations.map((rec) => (
            <article key={rec.title.id}>
              <div>
                <h3>{lang === 'ar' ? rec.title.titleAr : rec.title.titleEn}</h3>
                <p>{rec.title.description}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">{recsMessage}</p>
      )}

      <h2>{t.watchedTitle}</h2>
      {watched.length === 0 ? (
        <p className="muted">{t.empty}</p>
      ) : (
        <div className="results">
          {watched.map((state) => (
            <article key={state.id}>
              <div>
                <h3>{state.title ? (lang === 'ar' ? state.title.titleAr : state.title.titleEn) : state.titleId}</h3>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
