'use client';

import { useEffect, useState } from 'react';
import { api, type UserTitleState } from '../lib/api';

// The library (blueprint §5.3 "المكتبة"): what the user has watched and what
// they saved to watch. Recommendations live on the home screen
// (RecommendationsScreen), not here.
const labels = {
  ar: {
    eyebrow: 'المكتبة',
    title: 'قائمتي',
    watchlist: 'للمشاهدة لاحقًا',
    watchlistEmpty: 'لم تحفظ شيئًا بعد. من التوصيات اضغط «أضف إلى قائمتي».',
    watched: 'الأفلام المُشاهَدة',
    watchedEmpty: 'لم تُسجَّل أفلام مشاهَدة بعد.',
    loading: 'جارٍ التحميل…',
    failed: 'تعذّر تحميل قائمتك.',
  },
  en: {
    eyebrow: 'Library',
    title: 'My list',
    watchlist: 'To watch later',
    watchlistEmpty: 'Nothing saved yet. Use “Add to my list” on a recommendation.',
    watched: 'Watched films',
    watchedEmpty: 'No watched films recorded yet.',
    loading: 'Loading…',
    failed: 'Your list could not be loaded.',
  },
};

export function ListScreen({ lang, profileId }: { lang: 'ar' | 'en'; profileId: string }) {
  const [watched, setWatched] = useState<UserTitleState[]>([]);
  const [watchlist, setWatchlist] = useState<UserTitleState[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const t = labels[lang];

  useEffect(() => {
    let cancelled = false;
    // Re-affirm the loading state for a real re-fetch (profileId change);
    // redundant with the initial useState(true) on first mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    Promise.all([api.getWatchedTitles(profileId), api.getWatchlist(profileId)])
      .then(([watchedTitles, listed]) => {
        if (cancelled) return;
        setWatched(watchedTitles);
        setWatchlist(listed);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  function nameOf(state: UserTitleState) {
    return state.title ? (lang === 'ar' ? state.title.titleAr : state.title.titleEn) : state.titleId;
  }

  if (loading) {
    return <p className="muted">{t.loading}</p>;
  }

  if (failed) {
    return <p className="notice">{t.failed}</p>;
  }

  return (
    <>
      <p className="eyebrow">{t.eyebrow}</p>
      <h2>{t.title}</h2>

      <h3>{t.watchlist}</h3>
      {watchlist.length === 0 ? (
        <p className="muted">{t.watchlistEmpty}</p>
      ) : (
        <div className="results">
          {watchlist.map((state) => (
            <article key={state.id}>
              <div>
                <h3>{nameOf(state)}</h3>
              </div>
            </article>
          ))}
        </div>
      )}

      <h3>{t.watched}</h3>
      {watched.length === 0 ? (
        <p className="muted">{t.watchedEmpty}</p>
      ) : (
        <div className="results">
          {watched.map((state) => (
            <article key={state.id}>
              <div>
                <h3>{nameOf(state)}</h3>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
