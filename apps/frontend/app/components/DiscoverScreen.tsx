'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type Title, type TitleState } from '../lib/api';
import { formatNumber, todayLocal } from '../lib/format';
import { Poster } from './Poster';
import { genreLabel } from '../lib/genres';
import { Toast } from '../lib/toast';
import styles from './DiscoverScreen.module.css';

type Lang = 'ar' | 'en';

// Three watched titles unlock the first triad (SPECIFICATION.md §5.1 step 3).
const UNLOCK_COUNT = 3;
const PAGE_SIZE = 20;
// The starter list stays short on purpose (blueprint §4.2).
const STARTER_SIZE = 12;

const labels = {
  ar: {
    eyebrow: 'اكتشف',
    title: 'شاهدته؟ لمسة واحدة.',
    // Blueprint §4.2: quick picks from known titles, plus search; the start
    // must not become a long data-entry task.
    hint: 'المس صور ثلاثة أفلام شاهدتها. ثم نبدأ حكاية ذوقك.',
    searchLabel: 'ابحث بالاسم العربي أو الإنجليزي',
    searchPlaceholder: 'مثال: الوصول، Arrival',
    progress: (count: string) => `سجّلت ${count} كمُشاهَدة`,
    progressUnit: (n: number) => (n === 1 ? 'فيلمًا واحدًا' : n === 2 ? 'فيلمين' : n <= 10 ? `${formatNumber(n, 'ar')} أفلام` : `${formatNumber(n, 'ar')} فيلمًا`),
    needMore: (n: number) =>
      n === 1 ? 'بقي فيلم واحد لفتح الترتيب.' : n === 2 ? 'بقي فيلمان لفتح الترتيب.' : 'بقيت ثلاثة أفلام لفتح الترتيب.',
    unlocked: 'الترتيب متاح. كل فيلم إضافي يحسّن جولاتك.',
    goRank: 'إلى الترتيب',
    starter: 'عناوين للبدء',
    starterHint: 'بدايات متنوعة، قبل أن نتعرّف على ذوقك.',
    browseAll: 'تصفّح الكتالوج كاملًا',
    catalogue: (count: string) => `الكتالوج كاملًا: ${count}`,
    backToStarter: 'العودة إلى عناوين البدء',
    results: (count: string) => `نتائج البحث: ${count}`,
    noResults: 'لا نتائج. جرّب اسمًا آخر أو الاسم بلغة أخرى.',
    more: 'عرض المزيد',
    watched: 'شاهدته',
    // A tile has no room for words, so each target says its own name.
    markWatchedOf: (name: string) => `شاهدت «${name}»`,
    watchedOf: (name: string) => `«${name}» مسجَّل كمُشاهَد — المس للتراجع`,
    laterOf: (name: string) => `احفظ «${name}» لاحقًا`,
    onListOf: (name: string) => `«${name}» في قائمتك`,
    later: 'لاحقًا',
    onList: 'في قائمتك',
    watchedChip: 'مُشاهَد',
    undo: 'تراجع',
    watchedNotice: (title: string) => `سُجّل «${title}» كمُشاهَد.`,
    laterNotice: (title: string) => `أُضيف «${title}» إلى قائمتك.`,
    undoNotice: (title: string) => `أُلغي تسجيل «${title}». لن يُحتسب ضدّه.`,
    actionFailed: 'تعذّر الحفظ. حاول مجددًا.',
    loadFailed: 'تعذّر تحميل الكتالوج.',
    retry: 'إعادة المحاولة',
  },
  en: {
    eyebrow: 'Discover',
    title: 'Seen it? Just tap it.',
    hint: 'Tap three films you have seen. Your taste story starts here.',
    searchLabel: 'Search by Arabic or English title',
    searchPlaceholder: 'e.g. Arrival, الوصول',
    progress: (count: string) => `You have marked ${count} as watched`,
    progressUnit: (n: number) => (n === 1 ? 'one film' : `${formatNumber(n, 'en')} films`),
    needMore: (n: number) => (n === 1 ? 'One more film unlocks ranking.' : `${n === 2 ? 'Two' : 'Three'} more films unlock ranking.`),
    unlocked: 'Ranking is unlocked. Every extra film improves your rounds.',
    goRank: 'Go to ranking',
    starter: 'Titles to start with',
    starterHint: 'A diverse starting point, before we get to know your taste.',
    browseAll: 'Browse the whole catalogue',
    catalogue: (count: string) => `Whole catalogue: ${count}`,
    backToStarter: 'Back to the starter titles',
    results: (count: string) => `Search results: ${count}`,
    noResults: 'No results. Try another name, or the name in the other language.',
    more: 'Show more',
    watched: 'Watched it',
    markWatchedOf: (name: string) => `Watched ${name}`,
    watchedOf: (name: string) => `${name} is marked watched — tap to undo`,
    laterOf: (name: string) => `Save ${name} for later`,
    onListOf: (name: string) => `${name} is on your list`,
    later: 'Later',
    onList: 'On your list',
    watchedChip: 'Watched',
    undo: 'Undo',
    watchedNotice: (title: string) => `“${title}” is marked as watched.`,
    laterNotice: (title: string) => `“${title}” was added to your list.`,
    undoNotice: (title: string) => `“${title}” is no longer marked. It does not count against it.`,
    actionFailed: 'Could not save. Please try again.',
    loadFailed: 'The catalogue could not be loaded.',
    retry: 'Try again',
  },
};

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed' };

export function DiscoverScreen({
  lang,
  profileId,
  onGoToRank,
  onOpenTitle,
}: {
  lang: Lang;
  profileId: string;
  onGoToRank?: () => void;
  // Opens the work page for a catalogue title (no fit context here).
  onOpenTitle?: (title: Title, state: TitleState | null) => void;
}) {
  const t = labels[lang];
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // The profile's existing marks, so a returning user sees what they already
  // logged instead of a blank slate (previously marks reset per session).
  const [states, setStates] = useState<Map<string, TitleState>>(new Map());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Title[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searching, setSearching] = useState(false);
  // With an empty query: the diverse starter list (default) or the whole
  // paginated catalogue, at the user's choice.
  const [browseAll, setBrowseAll] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'success' | 'error'>('success');
  const [genre, setGenre] = useState<string | null>(null);

  const loadStates = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const [watched, watchlist] = await Promise.all([api.getWatchedTitles(profileId), api.getWatchlist(profileId)]);
      const next = new Map<string, TitleState>();
      for (const state of watchlist) next.set(state.titleId, 'watchlist');
      for (const state of watched) next.set(state.titleId, 'watched');
      setStates(next);
      setPhase({ kind: 'ready' });
    } catch {
      setPhase({ kind: 'failed' });
    }
  }, [profileId]);

  useEffect(() => {
    // loadStates' own setState calls all happen after an `await`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStates();
  }, [loadStates]);

  // Debounced search. An empty query shows the genre-diverse starter list
  // from the server (blueprint §4.2 "اختيار سريع من عناوين معروفة ومتنوعة"),
  // or the whole paginated catalogue when the user asks for it. Page 1 on
  // every new query.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearching(true);
    const trimmed = query.trim();
    const timer = window.setTimeout(() => {
      const load =
        trimmed || browseAll
          ? api.listTitles(trimmed, 1, PAGE_SIZE).then((result) => ({ items: result.items, total: result.total }))
          : api.getStarterTitles(STARTER_SIZE).then((items) => ({ items, total: items.length }));
      load
        .then((result) => {
          if (cancelled) return;
          setResults(result.items);
          setTotal(result.total);
          setPage(1);
        })
        .catch(() => {
          if (!cancelled) { setNoticeTone('error'); setNotice(t.loadFailed); }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, browseAll, t.loadFailed]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function loadMore() {
    const nextPage = page + 1;
    setSearching(true);
    try {
      const result = await api.listTitles(query.trim(), nextPage, PAGE_SIZE);
      setResults((current) => [...current, ...result.items]);
      setTotal(result.total);
      setPage(nextPage);
    } catch {
      setNoticeTone('error');
      setNotice(t.loadFailed);
    } finally {
      setSearching(false);
    }
  }

  // The only writes on this screen are exposure/list states -- never a
  // rating of any kind (blueprint §2.4 #2, ADR-4).
  async function setState(title: Title, state: TitleState, noticeFor: (name: string) => string) {
    const name = lang === 'ar' ? title.titleAr : title.titleEn;
    if (busyIds.has(title.id)) return;
    setBusyIds((current) => new Set(current).add(title.id));
    try {
      // ADR-104: the device's own local day, never the server's UTC clock,
      // and only when actually marking watched right now.
      await api.setTitleState(profileId, title.id, state === 'watched' ? { state, watchedOn: todayLocal() } : { state });
      setStates((current) => {
        const next = new Map(current);
        if (state === 'not_watched') next.delete(title.id);
        else next.set(title.id, state);
        return next;
      });
      setNoticeTone('success');
      setNotice(noticeFor(name));
    } catch {
      setNoticeTone('error');
      setNotice(t.actionFailed);
    } finally {
      setBusyIds((current) => { const next = new Set(current); next.delete(title.id); return next; });
    }
  }

  const watchedCount = [...states.values()].filter((state) => state === 'watched').length;
  const remaining = Math.max(0, UNLOCK_COUNT - watchedCount);
  const isSearch = query.trim().length > 0;
  const genres = [...new Set(results.flatMap((title) => title.genres ?? []))].slice(0, 8);
  const visibleResults = genre ? results.filter((title) => title.genres?.includes(genre)) : results;

  const header = (
    <div className={styles.header}>
      <div className={styles.headerCopy}>
        <p className={styles.eyebrow}><span aria-hidden="true">✦</span> {t.eyebrow}</p>
        <h2>{t.title}</h2>
        <p className={styles.hint}>{t.hint}</p>
      </div>
      <div className={styles.filmFan} aria-hidden="true">
        {results.slice(0, 4).map((title) => <Poster key={title.id} title={title} name={title.titleEn} className={styles.fanPoster} />)}
      </div>
    </div>
  );

  if (phase.kind === 'loading') {
    return (
      <div className={styles.screen} aria-busy="true">
        {header}
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
        <button type="button" className={styles.retry} onClick={loadStates}>
          {t.retry}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      {header}

      {/* Progress toward the three watched titles that unlock ranking. */}
      <div className={styles.progress} role="status">
        <div className={styles.progressRow}>
          <p className={styles.progressText}>{t.progress(t.progressUnit(watchedCount))}</p>
          <div className={styles.dots} aria-hidden="true">
            {Array.from({ length: UNLOCK_COUNT }, (_, index) => (
              <span key={index} className={index < watchedCount ? `${styles.dot} ${styles.dotOn}` : styles.dot} />
            ))}
          </div>
        </div>
        <p className={styles.progressNote}>{remaining > 0 ? t.needMore(remaining) : t.unlocked}</p>
        {remaining === 0 && onGoToRank && (
          <button type="button" className={styles.cta} onClick={onGoToRank}>
            {t.goRank}
          </button>
        )}
      </div>

      {notice && <Toast message={notice} tone={noticeTone} onDismiss={() => setNotice(null)} />}

      <div className={styles.search}>
        <label htmlFor="discover-search">{t.searchLabel}</label>
        <span className={styles.searchIcon} aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg></span>
        <input
          id="discover-search"
          type="search"
          placeholder={t.searchPlaceholder}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setGenre(null); }}
          autoComplete="off"
        />
      </div>

      {(genres.length > 1 || genre) && <div className={styles.filters} role="group" aria-label={lang === 'ar' ? 'تصفية العناوين المعروضة' : 'Filter the titles shown'}>
        <button type="button" aria-pressed={!genre} onClick={() => setGenre(null)}>{lang === 'ar' ? 'الكل' : 'All'}</button>
        {genres.map((item) => <button key={item} type="button" aria-pressed={genre === item} onClick={() => setGenre(genre === item ? null : item)}><span className={styles.genreDot} aria-hidden="true" />{genreLabel(item, lang)}</button>)}
      </div>}

      <h3 className={styles.sectionTitle}>
        {genre ? `${genreLabel(genre, lang)} · ${formatNumber(visibleResults.length, lang)} ${lang === 'ar' ? 'من المعروض' : 'shown'}` : isSearch ? t.results(formatNumber(total, lang)) : browseAll ? t.catalogue(formatNumber(total, lang)) : t.starter}
      </h3>
      {!isSearch && !browseAll && <p className={styles.progressNote}>{t.starterHint}</p>}

      {visibleResults.length === 0 && !searching ? (
        <p className={styles.empty}>{t.noResults}</p>
      ) : (
        <ul className={styles.grid} aria-busy={searching}>
          {visibleResults.map((title) => {
            const name = lang === 'ar' ? title.titleAr : title.titleEn;
            const state = states.get(title.id);
            const watched = state === 'watched';
            const listed = state === 'watchlist';
            const busy = busyIds.has(title.id);

            return (
              <li key={title.id} className={styles.cell}>
                {/* The poster is the answer to "ماذا شاهدت؟": one tap marks it,
                    the same tap again takes it back (UX_AUDIT_MOBILE_2026-09-05
                    P1 #16 -- this screen used to ask a visual question with
                    text cards and English paragraphs). A toggle, so assistive
                    tech reads the state rather than guessing from a tick. */}
                <div className={styles.tile}>
                  <button
                    type="button"
                    className={watched ? `${styles.pick} ${styles.picked}` : styles.pick}
                    aria-pressed={watched}
                    aria-label={watched ? t.watchedOf(name) : t.markWatchedOf(name)}
                    onClick={() => setState(title, watched ? 'not_watched' : 'watched', watched ? t.undoNotice : t.watchedNotice)}
                    disabled={busy}
                  >
                    <Poster title={title} size="md" className={styles.poster} name={name} />
                    <span className={styles.pickHint} aria-hidden="true">{busy ? '…' : watched ? '✓' : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg> {t.watched}</>}</span>
                    {watched && (
                      <span className={styles.check} aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12l5 5 9-10" />
                        </svg>
                      </span>
                    )}
                  </button>

                  {/* Saving for later is a second, smaller intent; it keeps its
                      own target rather than hiding behind a long press, which
                      the interaction addendum rules out. */}
                  <button
                    type="button"
                    className={listed ? `${styles.saveLater} ${styles.saved}` : styles.saveLater}
                    aria-pressed={listed}
                    aria-label={listed ? t.onListOf(name) : t.laterOf(name)}
                    onClick={() => setState(title, listed ? 'not_watched' : 'watchlist', listed ? t.undoNotice : t.laterNotice)}
                    disabled={busy || watched}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={listed ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
                      <path d="M7 4h10v16l-5-3.5L7 20z" />
                    </svg>
                  </button>
                </div>

                <h4 className={styles.title}>
                  {onOpenTitle ? (
                    <button type="button" className={styles.titleButton} onClick={() => onOpenTitle(title, state ?? null)}>
                      {name}
                    </button>
                  ) : (
                    name
                  )}
                </h4>
                {/* A year identifies; the other-language title and the synopsis
                    belong to the film's own page, which the title opens. */}
                {title.releaseYear && <p className={styles.year}>{String(title.releaseYear)}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {results.length < total && (
        <button type="button" className={`${styles.ghost} ${styles.more}`} onClick={loadMore} disabled={searching}>
          {t.more}
        </button>
      )}

      {!isSearch && (
        <button
          type="button"
          className={`${styles.ghost} ${styles.more}`}
          onClick={() => { setBrowseAll((current) => !current); setGenre(null); }}
          disabled={searching}
        >
          {browseAll ? t.backToStarter : t.browseAll}
        </button>
      )}
    </div>
  );
}
