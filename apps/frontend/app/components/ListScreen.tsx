'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type LibraryRankingItem, type Title, type UserTitleState } from '../lib/api';
import { formatConfidence, formatDate, formatNumber } from '../lib/format';
import styles from './ListScreen.module.css';

type Lang = 'ar' | 'en';

// The library (blueprint §5.3 "المكتبة", SPECIFICATION §5.4): what the user
// saved to watch, how their model orders what they have watched, and the
// watch timeline. Recommendations live on the home screen.
const labels = {
  ar: {
    eyebrow: 'المكتبة',
    title: 'قائمتي',
    hint: 'ما حفظته للمشاهدة، وكيف يرتّب نموذجك ما شاهدته، وسجل مشاهداتك.',
    filterLabel: 'تصفية بالاسم',
    filterPlaceholder: 'اكتب جزءًا من الاسم',
    watchlist: 'للمشاهدة لاحقًا',
    watchlistEmpty: 'لم تحفظ شيئًا بعد. من التوصيات أو اكتشف اضغط «لاحقًا».',
    ranking: 'ترتيبك الشخصي',
    rankingNote: 'بحسب نموذجك لا بحسب أي تقييم، وتغيّره جولات الترتيب القادمة.',
    rankingPending: 'يظهر ترتيبك بعد أن يُدرَّب نموذجك على جولات ترتيب كافية.',
    rankingEmpty: 'لا أفلام مُشاهَدة يمكن ترتيبها بعد.',
    rankingFailed: 'تعذّر تحميل الترتيب.',
    partialFingerprint: 'بعض سمات هذا الفيلم غير معروفة، فخُفّضت الثقة درجة.',
    model: (version: string) => `إصدار النموذج: ${version}`,
    timeline: 'سجل المشاهدة',
    timelineEmpty: 'لم تُسجَّل أفلام مشاهَدة بعد.',
    noDate: 'تاريخ غير مسجّل',
    noMatch: 'لا شيء يطابق التصفية.',
    watched: 'شاهدته',
    remove: 'إزالة',
    undo: 'تراجع',
    watchedNotice: (title: string) => `سُجّل «${title}» كمُشاهَد.`,
    removedNotice: (title: string) => `أُزيل «${title}» من قائمتك.`,
    undoNotice: (title: string) => `أُلغي تسجيل «${title}». لن يُحتسب ضدّه.`,
    actionFailed: 'تعذّر الحفظ. حاول مجددًا.',
    loadFailed: 'تعذّر تحميل قائمتك.',
    retry: 'إعادة المحاولة',
  },
  en: {
    eyebrow: 'Library',
    title: 'My list',
    hint: 'What you saved to watch, how your model orders what you have watched, and your watch history.',
    filterLabel: 'Filter by name',
    filterPlaceholder: 'Type part of a name',
    watchlist: 'To watch later',
    watchlistEmpty: 'Nothing saved yet. Press “Later” on a recommendation or in Discover.',
    ranking: 'Your personal ranking',
    rankingNote: 'By your model, not by any rating; upcoming ranking rounds change it.',
    rankingPending: 'Your ranking appears once your model has been trained on enough ranking rounds.',
    rankingEmpty: 'No watched films can be ranked yet.',
    rankingFailed: 'The ranking could not be loaded.',
    partialFingerprint: 'Some of this film’s traits are unknown, so confidence was lowered one band.',
    model: (version: string) => `Model version: ${version}`,
    timeline: 'Watch history',
    timelineEmpty: 'No watched films recorded yet.',
    noDate: 'Date not recorded',
    noMatch: 'Nothing matches the filter.',
    watched: 'Watched it',
    remove: 'Remove',
    undo: 'Undo',
    watchedNotice: (title: string) => `“${title}” is marked as watched.`,
    removedNotice: (title: string) => `“${title}” was removed from your list.`,
    undoNotice: (title: string) => `“${title}” is no longer marked. It does not count against it.`,
    actionFailed: 'Could not save. Please try again.',
    loadFailed: 'Your list could not be loaded.',
    retry: 'Try again',
  },
};

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed' };
type Ranking = { kind: 'loading' } | { kind: 'ready'; items: LibraryRankingItem[] } | { kind: 'pending' } | { kind: 'failed' };

export function ListScreen({ lang, profileId }: { lang: Lang; profileId: string }) {
  const t = labels[lang];
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [watched, setWatched] = useState<UserTitleState[]>([]);
  const [watchlist, setWatchlist] = useState<UserTitleState[]>([]);
  const [ranking, setRanking] = useState<Ranking>({ kind: 'loading' });
  const [filter, setFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadRanking = useCallback(async () => {
    setRanking({ kind: 'loading' });
    try {
      setRanking({ kind: 'ready', items: await api.getLibraryRanking(profileId) });
    } catch (err) {
      // 409 = no trained snapshot yet, the same honest answer recommendations give.
      setRanking(err instanceof ApiError && err.status === 409 ? { kind: 'pending' } : { kind: 'failed' });
    }
  }, [profileId]);

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const [watchedTitles, listed] = await Promise.all([api.getWatchedTitles(profileId), api.getWatchlist(profileId)]);
      setWatched(watchedTitles);
      setWatchlist(listed);
      setPhase({ kind: 'ready' });
    } catch {
      setPhase({ kind: 'failed' });
    }
    await loadRanking();
  }, [profileId, loadRanking]);

  useEffect(() => {
    // load's own setState calls all happen after an `await`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function nameOf(title: Title | undefined, fallback: string) {
    return title ? (lang === 'ar' ? title.titleAr : title.titleEn) : fallback;
  }

  function altOf(title: Title | undefined) {
    if (!title) return null;
    const alt = lang === 'ar' ? title.titleEn : title.titleAr;
    return alt && alt !== nameOf(title, '') ? alt : null;
  }

  function matches(title: Title | undefined) {
    const needle = filter.trim().toLowerCase();
    if (!needle || !title) return true;
    return title.titleAr.toLowerCase().includes(needle) || title.titleEn.toLowerCase().includes(needle);
  }

  // Only exposure/list states are ever written here -- never a rating (ADR-4).
  async function markWatched(state: UserTitleState) {
    const name = nameOf(state.title, state.titleId);
    setBusyId(state.titleId);
    try {
      const updated = await api.setTitleState(profileId, state.titleId, { state: 'watched' });
      setWatchlist((current) => current.filter((item) => item.titleId !== state.titleId));
      setWatched((current) => [{ ...updated, title: state.title }, ...current]);
      setNotice(t.watchedNotice(name));
      // The watched set changed, so the model's ordering of it may too.
      await loadRanking();
    } catch {
      setNotice(t.actionFailed);
    } finally {
      setBusyId(null);
    }
  }

  // Back to "exposure unknown" -- never a negative signal (blueprint §2.4 #3).
  async function clearState(state: UserTitleState, noticeFor: (name: string) => string) {
    const name = nameOf(state.title, state.titleId);
    setBusyId(state.titleId);
    try {
      await api.setTitleState(profileId, state.titleId, { state: 'not_watched' });
      setWatchlist((current) => current.filter((item) => item.titleId !== state.titleId));
      const wasWatched = watched.some((item) => item.titleId === state.titleId);
      setWatched((current) => current.filter((item) => item.titleId !== state.titleId));
      setNotice(noticeFor(name));
      if (wasWatched) await loadRanking();
    } catch {
      setNotice(t.actionFailed);
    } finally {
      setBusyId(null);
    }
  }

  const header = (
    <div className={styles.header}>
      <p className="eyebrow">{t.eyebrow}</p>
      <h2>{t.title}</h2>
      <p className={styles.hint}>{t.hint}</p>
    </div>
  );

  if (phase.kind === 'loading') {
    return (
      <div className={styles.screen} aria-busy="true">
        {header}
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <div className={styles.screen}>
        {header}
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {t.loadFailed}
        </p>
        <button type="button" className="cta full" onClick={load}>
          {t.retry}
        </button>
      </div>
    );
  }

  const visibleWatchlist = watchlist.filter((state) => matches(state.title));
  // Timeline: most recent watch first; undated rows (legacy) last.
  const visibleWatched = watched
    .filter((state) => matches(state.title))
    .slice()
    .sort((left, right) => (right.watchedAt ? Date.parse(right.watchedAt) : 0) - (left.watchedAt ? Date.parse(left.watchedAt) : 0));
  const visibleRanking = ranking.kind === 'ready' ? ranking.items.filter((item) => matches(item.title)) : [];
  const filtering = filter.trim().length > 0;

  return (
    <div className={styles.screen}>
      {header}
      {notice && (
        <p className={styles.status} role="status">
          {notice}
        </p>
      )}

      <div className={styles.filter}>
        <label htmlFor="library-filter">{t.filterLabel}</label>
        <input
          id="library-filter"
          type="search"
          placeholder={t.filterPlaceholder}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          autoComplete="off"
        />
      </div>

      <section className={styles.section} aria-label={t.watchlist}>
        <div className={styles.sectionHeader}>
          <h3>
            {t.watchlist}
            <span className={styles.chip}>{formatNumber(watchlist.length, lang)}</span>
          </h3>
        </div>
        {watchlist.length === 0 ? (
          <p className={styles.empty}>{t.watchlistEmpty}</p>
        ) : visibleWatchlist.length === 0 ? (
          <p className={styles.empty}>{t.noMatch}</p>
        ) : (
          <ul className={styles.list}>
            {visibleWatchlist.map((state) => {
              const meta = [state.title?.releaseYear, state.title?.genres?.join(' · ')].filter(Boolean).join(' · ');
              const busy = busyId === state.titleId;
              return (
                <li key={state.id} className={styles.card}>
                  <div>
                    <h4 className={styles.title}>{nameOf(state.title, state.titleId)}</h4>
                    {altOf(state.title) && <p className={styles.alt}>{altOf(state.title)}</p>}
                    {meta && <p className={styles.meta}>{meta}</p>}
                  </div>
                  <div className={styles.actions}>
                    <button type="button" className={styles.ghost} onClick={() => markWatched(state)} disabled={busy}>
                      {t.watched}
                    </button>
                    <button type="button" className={styles.ghost} onClick={() => clearState(state, t.removedNotice)} disabled={busy}>
                      {t.remove}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-label={t.ranking}>
        <div className={styles.sectionHeader}>
          <h3>{t.ranking}</h3>
          <p>{t.rankingNote}</p>
        </div>
        {ranking.kind === 'loading' && <div className={styles.skeleton} />}
        {ranking.kind === 'pending' && <p className={styles.empty}>{t.rankingPending}</p>}
        {ranking.kind === 'failed' && (
          <p className={`${styles.status} ${styles.error}`} role="alert">
            {t.rankingFailed}
          </p>
        )}
        {ranking.kind === 'ready' &&
          (ranking.items.length === 0 ? (
            <p className={styles.empty}>{t.rankingEmpty}</p>
          ) : visibleRanking.length === 0 ? (
            <p className={styles.empty}>{t.noMatch}</p>
          ) : (
            <>
              <ol className={styles.list}>
                {visibleRanking.map((item) => {
                  const confidence = formatConfidence(item.confidenceBand, lang);
                  return (
                    <li key={item.title.id} className={`${styles.card} ${styles.ranked}`} aria-label={formatNumber(item.position, lang)}>
                      {/* The position inside the whole ranking, kept even under a filter. */}
                      <span className={styles.badge} aria-hidden="true">
                        {formatNumber(item.position, lang)}
                      </span>
                      <div>
                        <h4 className={styles.title}>
                          {nameOf(item.title, item.title.id)}
                          <span className={styles.chip}>{confidence.label}</span>
                        </h4>
                        {altOf(item.title) && <p className={styles.alt}>{altOf(item.title)}</p>}
                        {item.fingerprintCoverage < 1 && <p className={styles.note}>{t.partialFingerprint}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {!filtering && <p className={styles.note}>{t.model(ranking.items[0].modelVersion)}</p>}
            </>
          ))}
      </section>

      <section className={styles.section} aria-label={t.timeline}>
        <div className={styles.sectionHeader}>
          <h3>
            {t.timeline}
            <span className={styles.chip}>{formatNumber(watched.length, lang)}</span>
          </h3>
        </div>
        {watched.length === 0 ? (
          <p className={styles.empty}>{t.timelineEmpty}</p>
        ) : visibleWatched.length === 0 ? (
          <p className={styles.empty}>{t.noMatch}</p>
        ) : (
          <ul className={styles.list}>
            {visibleWatched.map((state) => {
              const busy = busyId === state.titleId;
              return (
                <li key={state.id} className={styles.card}>
                  <div>
                    <h4 className={styles.title}>{nameOf(state.title, state.titleId)}</h4>
                    {altOf(state.title) && <p className={styles.alt}>{altOf(state.title)}</p>}
                    <p className={styles.meta}>{state.watchedAt ? formatDate(state.watchedAt, lang) : t.noDate}</p>
                  </div>
                  <div className={styles.actions}>
                    <button type="button" className={styles.ghost} onClick={() => clearState(state, t.undoNotice)} disabled={busy}>
                      {t.undo}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
