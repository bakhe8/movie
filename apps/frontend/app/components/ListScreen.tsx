'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type LibraryRankingItem, type Title, type TitleState, type UserTitleState } from '../lib/api';
import { formatNumber, formatWatchedOn, todayLocal } from '../lib/format';
import { Toast } from '../lib/toast';
import { Poster } from './Poster';
import styles from './ListScreen.module.css';
import { WorkCard } from './WorkCard';

type Lang = 'ar' | 'en';

// The library (blueprint §5.3 "المكتبة", SPECIFICATION §5.4): what the user
// saved to watch, how their model orders what they have watched, and the
// watch timeline. Recommendations live on the home screen.
const labels = {
  ar: {
    eyebrow: 'المكتبة',
    title: 'قائمتي',
    openFilm: 'افتح الفيلم',
    hint: 'أفلام لليلة القادمة. وذكريات تستحق العودة.',
    filterLabel: 'تصفية بالاسم',
    filterPlaceholder: 'ابحث في مكتبتك',
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
    // Diary (blueprint §5.3 "يوميات"): a private note and a corrected watch date.
    diary: 'اليوميات',
    diaryEdit: 'تعديل اليوميات',
    diaryDate: 'تاريخ المشاهدة',
    diaryNotes: 'ملاحظاتك',
    diaryHint: 'خاصة بك، ولا تدخل النموذج. الترتيب وحده يعلّمه.',
    diarySave: 'حفظ',
    diaryCancel: 'إلغاء',
    diarySaved: (title: string) => `حُفظت يوميات «${title}».`,
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
    openFilm: 'Open film',
    hint: 'Your next movie night. Your favourite memories.',
    filterLabel: 'Filter by name',
    filterPlaceholder: 'Find a film in your library',
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
    diary: 'Diary',
    diaryEdit: 'Edit diary',
    diaryDate: 'Watch date',
    diaryNotes: 'Your notes',
    diaryHint: 'Private to you, and never fed to the model. Only ranking teaches it.',
    diarySave: 'Save',
    diaryCancel: 'Cancel',
    diarySaved: (title: string) => `Diary for “${title}” saved.`,
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

export function ListScreen({
  lang,
  profileId,
  onOpenTitle,
  onOpenCatalogTitle,
}: {
  lang: Lang;
  profileId: string;
  // Opens the work page with this ranking row as its context (blueprint §5.3).
  onOpenTitle?: (item: LibraryRankingItem, count: number) => void;
  onOpenCatalogTitle?: (title: Title, state: TitleState) => void;
}) {
  const t = labels[lang];
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [watched, setWatched] = useState<UserTitleState[]>([]);
  const [watchlist, setWatchlist] = useState<UserTitleState[]>([]);
  const [ranking, setRanking] = useState<Ranking>({ kind: 'loading' });
  const [filter, setFilter] = useState('');
  const [activeSection, setActiveSection] = useState<'watchlist' | 'ranking' | 'timeline'>('watchlist');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The diary editor open on one timeline item: date as yyyy-mm-dd, notes as typed.
  const [diary, setDiary] = useState<{ titleId: string; date: string; notes: string } | null>(null);

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

  function catalogPoster(state: UserTitleState, size: 'md' | 'lg', className?: string) {
    const poster = <Poster title={state.title} size={size} name={nameOf(state.title, '')} className={className} />;
    const title = state.title;
    return title && onOpenCatalogTitle ? (
      <button type="button" className={styles.posterOpen} aria-label={`${t.openFilm}: ${nameOf(title, '')}`} onClick={() => onOpenCatalogTitle(title, state.state)}>
        {poster}
      </button>
    ) : poster;
  }

  function catalogHeading(state: UserTitleState) {
    const title = state.title;
    const name = nameOf(title, state.titleId);
    return (
      <h4 className={styles.title}>
        {title && onOpenCatalogTitle ? <button type="button" className={styles.titleOpen} onClick={() => onOpenCatalogTitle(title, state.state)}>{name}</button> : name}
      </h4>
    );
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
      // ADR-104: the device's own local day, never the server's UTC clock.
      const updated = await api.setTitleState(profileId, state.titleId, { state: 'watched', watchedOn: todayLocal() });
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

  function openDiary(state: UserTitleState) {
    setDiary({
      titleId: state.titleId,
      date: state.watchedOn ?? todayLocal(),
      notes: state.notes ?? '',
    });
  }

  // The diary (blueprint §5.3): a private note and a corrected watch date on
  // an already-watched title. Free text and a date -- never a rating, and
  // never read by training (ADR-4).
  async function saveDiary(state: UserTitleState) {
    if (!diary) return;
    const name = nameOf(state.title, state.titleId);
    setBusyId(state.titleId);
    try {
      const notes = diary.notes.trim();
      // ADR-104: the date field's own value, verbatim -- never reconstructed
      // through a Date object, which is exactly what let editing the note
      // alone silently shift the stored day (DATE-01).
      const updated = await api.setTitleState(profileId, state.titleId, {
        state: 'watched',
        watchedOn: diary.date,
        notes: notes.length > 0 ? notes : null,
      });
      setWatched((current) => current.map((item) => (item.titleId === state.titleId ? { ...updated, title: state.title } : item)));
      setDiary(null);
      setNotice(t.diarySaved(name));
    } catch {
      setNotice(t.actionFailed);
    } finally {
      setBusyId(null);
    }
  }

  const header = (
    <div className={styles.header}>
      <div className={styles.headerCopy}>
      <p className={styles.eyebrow}>{t.eyebrow}</p>
      <h2>{t.title}</h2>
      <p className={styles.hint}>{t.hint}</p>
      </div>
      <div className={styles.posterFan} aria-hidden="true">
        {(watchlist.length ? watchlist : watched).slice(0, 3).map((state) => (
          <Poster key={state.id} title={state.title} name={nameOf(state.title, '')} size="md" className={styles.fanPoster} />
        ))}
      </div>
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
        <button type="button" className={styles.retry} onClick={load}>
          {t.retry}
        </button>
      </div>
    );
  }

  const visibleWatchlist = watchlist.filter((state) => matches(state.title));
  // Timeline: most recent watch first; undated rows (legacy) last. Plain
  // 'YYYY-MM-DD' strings sort lexicographically in calendar order, so no
  // Date.parse (and no timezone) is involved (ADR-104).
  const visibleWatched = watched
    .filter((state) => matches(state.title))
    .slice()
    .sort((left, right) => (right.watchedOn ?? '').localeCompare(left.watchedOn ?? ''));
  const visibleRanking = ranking.kind === 'ready' ? ranking.items.filter((item) => matches(item.title)) : [];
  const filtering = filter.trim().length > 0;

  return (
    <div className={styles.screen}>
      {header}
      {notice && (
        <Toast message={notice} tone={notice === t.actionFailed ? 'error' : 'success'} onDismiss={() => setNotice(null)} />
      )}

      <div className={styles.libraryTabs} role="tablist" aria-label={t.eyebrow}>
        {([
          { id: 'watchlist', label: t.watchlist, count: watchlist.length, path: 'M6 3h12v18l-6-4-6 4z' },
          { id: 'ranking', label: t.ranking, count: ranking.kind === 'ready' ? ranking.items.length : null, path: 'M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7' },
          { id: 'timeline', label: t.timeline, count: watched.length, path: 'M12 8v5l3 2M21 12a9 9 0 1 1-3-6.7M21 3v6h-6' },
        ] as const).map((tab) => (
          <button key={tab.id} id={`library-tab-${tab.id}`} type="button" role="tab" aria-selected={activeSection === tab.id} aria-controls={`library-${tab.id}`} tabIndex={activeSection === tab.id ? 0 : -1} onClick={() => setActiveSection(tab.id)}
            onKeyDown={(event) => {
              const ids = ['watchlist', 'ranking', 'timeline'] as const;
              const nextKey = lang === 'ar' ? 'ArrowLeft' : 'ArrowRight';
              const previousKey = lang === 'ar' ? 'ArrowRight' : 'ArrowLeft';
              if (![nextKey, previousKey, 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const index = ids.indexOf(tab.id);
              const next = event.key === 'Home' ? ids[0] : event.key === 'End' ? ids[2] : ids[(index + (event.key === nextKey ? 1 : 2)) % 3];
              setActiveSection(next);
              document.getElementById(`library-tab-${next}`)?.focus();
            }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={tab.path} /></svg>
            <span>{tab.label}</span>
            {tab.count !== null && <b>{formatNumber(tab.count, lang)}</b>}
          </button>
        ))}
      </div>

      <div className={styles.filter}>
        <label htmlFor="library-filter">{t.filterLabel}</label>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
        <input
          id="library-filter"
          type="search"
          placeholder={t.filterPlaceholder}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          autoComplete="off"
        />
      </div>

      <section id="library-watchlist" role="tabpanel" aria-labelledby="library-tab-watchlist" hidden={activeSection !== 'watchlist'} className={styles.section} data-role="later">
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
          <ul className={`${styles.list} ${styles.posterGrid}`}>
            {visibleWatchlist.map((state) => {
              const meta = state.title?.releaseYear ? String(state.title.releaseYear) : '';
              const busy = busyId === state.titleId;
              return (
                <li key={state.id} className={styles.card}>
                  <div className={styles.cardHead}>
                    {catalogPoster(state, 'lg', styles.libraryPoster)}
                    <div className={styles.cardBody}>
                      {catalogHeading(state)}
                      {altOf(state.title) && <p className={styles.alt}>{altOf(state.title)}</p>}
                      {meta && <p className={styles.meta}>{meta}</p>}
                    </div>
                  </div>
                  <div className={styles.actions}>
                    <button type="button" className={styles.ghost} onClick={() => markWatched(state)} disabled={busy}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
                      {t.watched}
                    </button>
                    <button type="button" className={`${styles.ghost} ${styles.iconAction}`} aria-label={`${t.remove}: ${nameOf(state.title, state.titleId)}`} onClick={() => clearState(state, t.removedNotice)} disabled={busy}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section id="library-ranking" role="tabpanel" aria-labelledby="library-tab-ranking" hidden={activeSection !== 'ranking'} className={styles.section}>
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
                {visibleRanking.map((item) => (
                  <li key={item.title.id} className={styles.item}>
                    {/* The work card in its ranking kind (SPEC §5.4, ADR-33): the
                        position inside the whole watched set -- kept even under a
                        filter -- plus confidence and the driving traits. */}
                    <WorkCard
                      lang={lang}
                      kind="ranking"
                      item={item}
                      position={item.position}
                      count={ranking.items.length}
                      onOpen={onOpenTitle ? () => onOpenTitle(item, ranking.items.length) : undefined}
                    />
                  </li>
                ))}
              </ol>
              {!filtering && <p className={styles.note}>{t.model(ranking.items[0].modelVersion)}</p>}
            </>
          ))}
      </section>

      <section id="library-timeline" role="tabpanel" aria-labelledby="library-tab-timeline" hidden={activeSection !== 'timeline'} className={styles.section}>
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
              const editing = diary?.titleId === state.titleId;
              return (
                <li key={state.id} className={editing ? `${styles.card} ${styles.cardEditing}` : styles.card}>
                  <div className={styles.cardHead}>
                    {catalogPoster(state, 'md')}
                    <div className={styles.cardBody}>
                      {catalogHeading(state)}
                      {altOf(state.title) && <p className={styles.alt}>{altOf(state.title)}</p>}
                      <p className={styles.meta}>{state.watchedOn ? formatWatchedOn(state.watchedOn, lang) : t.noDate}</p>
                      {!editing && state.notes && <p className={styles.noteText}>{state.notes}</p>}
                    </div>
                  </div>
                  {editing && diary ? (
                    <form
                      className={styles.diary}
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveDiary(state);
                      }}
                    >
                      <div className={styles.field}>
                        <label htmlFor={`diary-date-${state.titleId}`}>{t.diaryDate}</label>
                        <input
                          id={`diary-date-${state.titleId}`}
                          type="date"
                          value={diary.date}
                          max={todayLocal()}
                          onChange={(event) => setDiary({ ...diary, date: event.target.value })}
                          required
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`diary-notes-${state.titleId}`}>{t.diaryNotes}</label>
                        <textarea
                          id={`diary-notes-${state.titleId}`}
                          value={diary.notes}
                          maxLength={1000}
                          rows={3}
                          onChange={(event) => setDiary({ ...diary, notes: event.target.value })}
                        />
                        <p className={styles.note}>{t.diaryHint}</p>
                      </div>
                      <div className={styles.actions}>
                        <button type="submit" className={styles.ghost} disabled={busy}>
                          {t.diarySave}
                        </button>
                        <button type="button" className={styles.ghost} onClick={() => setDiary(null)} disabled={busy}>
                          {t.diaryCancel}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className={styles.actions}>
                      <button type="button" className={styles.ghost} onClick={() => openDiary(state)} disabled={busy}>
                        {state.notes ? t.diaryEdit : t.diary}
                      </button>
                      <button type="button" className={styles.ghost} onClick={() => clearState(state, t.undoNotice)} disabled={busy}>
                        {t.undo}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
