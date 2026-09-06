'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
    titleReady: 'اكتشف ما فاتك.',
    // Blueprint §4.2: quick picks from known titles, plus search; the start
    // must not become a long data-entry task.
    hint: 'المس صور ثلاثة أفلام شاهدتها. ثم نبدأ حكاية ذوقك.',
    hintReady: 'اقتراحاتك في الرئيسية. وهنا تستطيع توسيع سجل المشاهدة وقتما تشاء.',
    searchLabel: 'ابحث بالاسم العربي أو الإنجليزي',
    searchPlaceholder: 'مثال: الوصول، Arrival',
    progress: (count: string) => `سجّلت ${count} كمُشاهَدة`,
    progressUnit: (n: number) => (n === 1 ? 'فيلمًا واحدًا' : n === 2 ? 'فيلمين' : n <= 10 ? `${formatNumber(n, 'ar')} أفلام` : `${formatNumber(n, 'ar')} فيلمًا`),
    needMore: (n: number) =>
      n === 1 ? 'بقي فيلم واحد لفتح الترتيب.' : n === 2 ? 'بقي فيلمان لفتح الترتيب.' : 'بقيت ثلاثة أفلام لفتح الترتيب.',
    unlocked: 'الترتيب متاح. كل فيلم إضافي يحسّن جولاتك.',
    goRank: 'إلى الترتيب',
    history: (count: string) => `سجل المشاهدة · ${count}`,
    openHistory: (count: string) => `عرض سجل المشاهدة، ${count}`,
    starter: 'عناوين للبدء',
    continueDiscovering: 'عناوين أخرى لاكتشافها',
    starterHint: 'بدايات متنوعة، قبل أن نتعرّف على ذوقك.',
    browseAll: 'تصفّح الكتالوج كاملًا',
    catalogue: (count: string) => `الكتالوج كاملًا: ${count}`,
    backToStarter: 'العودة إلى عناوين البدء',
    results: (count: string) => `نتائج البحث: ${count}`,
    noResults: 'لا نتائج. جرّب اسمًا آخر أو الاسم بلغة أخرى.',
    noUnwatched: 'لا توجد عناوين جديدة هنا. أفلامك المُشاهَدة محفوظة في السجل.',
    more: 'عرض المزيد',
    watched: 'شاهدته',
    // A tile has no room for words, so each target says its own name.
    markWatchedOf: (name: string) => `شاهدت «${name}»`,
    laterOf: (name: string) => `احفظ «${name}» لاحقًا`,
    onListOf: (name: string) => `«${name}» في قائمتك`,
    later: 'لاحقًا',
    onList: 'في قائمتك',
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
    titleReady: 'Discover what you missed.',
    hint: 'Tap three films you have seen. Your taste story starts here.',
    hintReady: 'Your recommendations are on Home. Here, you can expand your watch history whenever you like.',
    searchLabel: 'Search by Arabic or English title',
    searchPlaceholder: 'e.g. Arrival, الوصول',
    progress: (count: string) => `You have marked ${count} as watched`,
    progressUnit: (n: number) => (n === 1 ? 'one film' : `${formatNumber(n, 'en')} films`),
    needMore: (n: number) => (n === 1 ? 'One more film unlocks ranking.' : `${n === 2 ? 'Two' : 'Three'} more films unlock ranking.`),
    unlocked: 'Ranking is unlocked. Every extra film improves your rounds.',
    goRank: 'Go to ranking',
    history: (count: string) => `Watch history · ${count}`,
    openHistory: (count: string) => `Open watch history, ${count}`,
    starter: 'Titles to start with',
    continueDiscovering: 'More titles to discover',
    starterHint: 'A diverse starting point, before we get to know your taste.',
    browseAll: 'Browse the whole catalogue',
    catalogue: (count: string) => `Whole catalogue: ${count}`,
    backToStarter: 'Back to the starter titles',
    results: (count: string) => `Search results: ${count}`,
    noResults: 'No results. Try another name, or the name in the other language.',
    noUnwatched: 'There are no new titles here. Your watched films are saved in your history.',
    more: 'Show more',
    watched: 'Watched it',
    markWatchedOf: (name: string) => `Watched ${name}`,
    laterOf: (name: string) => `Save ${name} for later`,
    onListOf: (name: string) => `${name} is on your list`,
    later: 'Later',
    onList: 'On your list',
    watchedNotice: (title: string) => `“${title}” is marked as watched.`,
    laterNotice: (title: string) => `“${title}” was added to your list.`,
    undoNotice: (title: string) => `“${title}” is no longer marked. It does not count against it.`,
    actionFailed: 'Could not save. Please try again.',
    loadFailed: 'The catalogue could not be loaded.',
    retry: 'Try again',
  },
};

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed' };

export type DiscoverViewState = { query: string; browseAll: boolean; genre: string | null; pagesLoaded?: number };

export function DiscoverScreen({
  lang,
  profileId,
  onGoToRank,
  onOpenHistory,
  onOpenTitle,
  initialViewState,
}: {
  lang: Lang;
  profileId: string;
  onGoToRank?: () => void;
  // Watch history belongs to the library; Discover only offers titles that
  // can still add something to the watched set.
  onOpenHistory?: () => void;
  // Opens the work page for a catalogue title (no fit context here).
  onOpenTitle?: (title: Title, state: TitleState | null, viewState: DiscoverViewState) => void;
  initialViewState?: DiscoverViewState;
}) {
  const t = labels[lang];
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [recommendationsReady, setRecommendationsReady] = useState(false);
  // The profile's existing marks, so a returning user sees what they already
  // logged instead of a blank slate (previously marks reset per session).
  const [states, setStates] = useState<Map<string, TitleState>>(new Map());
  const [query, setQuery] = useState(initialViewState?.query ?? '');
  const [results, setResults] = useState<Title[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pagesToRestore, setPagesToRestore] = useState(initialViewState?.pagesLoaded ?? 1);
  const [searching, setSearching] = useState(false);
  // With an empty query: the diverse starter list (default) or the whole
  // paginated catalogue, at the user's choice.
  const [browseAll, setBrowseAll] = useState(initialViewState?.browseAll ?? false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'success' | 'error'>('success');
  const [genre, setGenre] = useState<string | null>(initialViewState?.genre ?? null);
  // The chip bar keeps offering every genre seen, even once one is picked and
  // the loaded results narrow to it -- so it is only refreshed from an
  // unfiltered fetch, never from a genre-filtered one.
  const [availableGenres, setAvailableGenres] = useState<string[]>([]);
  const searchRevision = useRef(0);
  const pendingPage = useRef<number | null>(null);

  const loadStates = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      // Readiness only chooses honest copy; a temporary failure must not make
      // the catalogue itself unavailable.
      const [watched, watchlist, readiness] = await Promise.all([
        api.getWatchedTitles(profileId),
        api.getWatchlist(profileId),
        api.getReadiness(profileId).catch(() => null),
      ]);
      const next = new Map<string, TitleState>();
      for (const state of watchlist) next.set(state.titleId, 'watchlist');
      for (const state of watched) next.set(state.titleId, 'watched');
      setStates(next);
      setRecommendationsReady(readiness?.recommendation.status === 'ready');
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

  // Debounced search. An empty query and no genre shows the genre-diverse
  // starter list from the server (blueprint §4.2 "اختيار سريع من عناوين
  // معروفة ومتنوعة"); a search, "browse all", or a picked genre reads the
  // whole paginated catalogue instead, with the genre filter applied on the
  // server so it reaches every matching title, not just the loaded page.
  // Page 1 on every new query. Returning from a film re-reads every
  // previously loaded page so a restored genre can still find films beyond
  // the first page.
  useEffect(() => {
    let cancelled = false;
    const revision = ++searchRevision.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearching(true);
    const trimmed = query.trim();
    const timer = window.setTimeout(() => {
      const filterArgs: [{ genre: string }] | [] = genre ? [{ genre }] : [];
      const load =
        trimmed || browseAll || genre
          ? Promise.all(
              Array.from({ length: pagesToRestore }, (_, index) => api.listTitles(trimmed, index + 1, PAGE_SIZE, ...filterArgs)),
            ).then((pages) => ({ items: pages.flatMap((result) => result.items), total: pages[0].total, page: pages.length }))
          : api.getStarterTitles(STARTER_SIZE).then((items) => ({ items, total: items.length, page: 1 }));
      load
        .then((result) => {
          if (cancelled) return;
          setResults(result.items);
          setTotal(result.total);
          setPage(result.page);
          if (!genre) {
            // Not narrowed to unwatched titles (unlike the rendered grid):
            // the chip bar's purpose is showing what genres exist at all, so
            // it should not depend on `states` and refetch on every mark.
            setAvailableGenres([...new Set(result.items.flatMap((title) => title.genres ?? []))].slice(0, 8));
          } else {
            // A genre restored from a saved view (e.g. after opening a film)
            // has no other chips yet; at least its own chip must render, and
            // pressed, so the filter is visibly active and can be cleared.
            setAvailableGenres((current) => (current.includes(genre) ? current : [...current, genre]));
          }
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
      searchRevision.current = revision + 1;
      window.clearTimeout(timer);
    };
  }, [query, browseAll, genre, pagesToRestore, t.loadFailed]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function loadMore() {
    const revision = searchRevision.current;
    if (pendingPage.current === revision) return;
    pendingPage.current = revision;
    const nextPage = page + 1;
    setSearching(true);
    try {
      const result = await api.listTitles(query.trim(), nextPage, PAGE_SIZE, ...(genre ? [{ genre }] as const : []));
      // Changing the search invalidates pagination as well as its first read.
      if (revision !== searchRevision.current) return;
      setResults((current) => [...current, ...result.items]);
      setTotal(result.total);
      setPage(nextPage);
      if (!genre) {
        setAvailableGenres((current) => [...new Set([...current, ...result.items.flatMap((title) => title.genres ?? [])])].slice(0, 8));
      }
    } catch {
      if (revision !== searchRevision.current) return;
      setNoticeTone('error');
      setNotice(t.loadFailed);
    } finally {
      if (pendingPage.current === revision) pendingPage.current = null;
      if (revision === searchRevision.current) setSearching(false);
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
  // The server already applied the genre filter (across the whole catalogue,
  // not just this loaded page) when `genre` is set, so no local re-filtering
  // is needed here.
  const visibleResults = results.filter((title) => states.get(title.id) !== 'watched');
  const watchedCountLabel = t.progressUnit(watchedCount);

  const header = (
    <div className={styles.header}>
      <div className={styles.headerCopy}>
        <p className={styles.eyebrow}><span aria-hidden="true">✦</span> {t.eyebrow}</p>
        <h2>{recommendationsReady ? t.titleReady : t.title}</h2>
        <p className={styles.hint}>{recommendationsReady ? t.hintReady : t.hint}</p>
      </div>
      <div className={styles.filmFan} aria-hidden="true">
        {visibleResults.slice(0, 4).map((title) => <Poster key={title.id} title={title} name={title.titleEn} className={styles.fanPoster} />)}
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
      <div className={remaining === 0 ? `${styles.progress} ${styles.progressReady}` : styles.progress}>
        <div className={styles.progressRow}>
          {onOpenHistory ? (
            <button type="button" className={styles.historyLink} aria-label={t.openHistory(watchedCountLabel)} onClick={onOpenHistory}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 8v5l3 2" />
                <path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" />
              </svg>
              {t.history(watchedCountLabel)}
            </button>
          ) : (
            <p className={styles.progressText}>{t.progress(watchedCountLabel)}</p>
          )}
          <div className={styles.dots} aria-hidden="true">
            {Array.from({ length: UNLOCK_COUNT }, (_, index) => (
              <span key={index} className={index < watchedCount ? `${styles.dot} ${styles.dotOn}` : styles.dot} />
            ))}
          </div>
        </div>
        <p className={styles.progressNote} role="status">{remaining > 0 ? t.needMore(remaining) : t.unlocked}</p>
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
          onChange={(event) => { setQuery(event.target.value); setGenre(null); setPagesToRestore(1); }}
          autoComplete="off"
        />
      </div>

      {(availableGenres.length > 1 || genre) && <div className={styles.filters} role="group" aria-label={lang === 'ar' ? 'تصفية العناوين المعروضة' : 'Filter the titles shown'}>
        <button type="button" aria-pressed={!genre} onClick={() => { setGenre(null); setPagesToRestore(1); }}>{lang === 'ar' ? 'الكل' : 'All'}</button>
        {availableGenres.map((item) => (
          <button key={item} type="button" aria-pressed={genre === item} onClick={() => { setGenre(genre === item ? null : item); setPagesToRestore(1); }}>
            <span className={styles.genreDot} aria-hidden="true" />{genreLabel(item, lang)}
          </button>
        ))}
      </div>}

      <h3 className={styles.sectionTitle}>
        {/* `total` comes from the server, so once a genre is picked this
            counts every match in the whole catalogue, not just this page. */}
        {genre ? `${genreLabel(genre, lang)} · ${formatNumber(total, lang)} ${lang === 'ar' ? 'في الكتالوج' : 'in the catalogue'}` : isSearch ? t.results(formatNumber(total, lang)) : browseAll ? t.catalogue(formatNumber(total, lang)) : recommendationsReady ? t.continueDiscovering : t.starter}
      </h3>
      {!isSearch && !browseAll && !recommendationsReady && <p className={styles.progressNote}>{t.starterHint}</p>}

      {visibleResults.length === 0 && !searching ? (
        <p className={styles.empty}>{results.length > 0 ? t.noUnwatched : t.noResults}</p>
      ) : (
        <ul className={styles.grid} aria-busy={searching}>
          {visibleResults.map((title) => {
            const name = lang === 'ar' ? title.titleAr : title.titleEn;
            const state = states.get(title.id);
            const listed = state === 'watchlist';
            const busy = busyIds.has(title.id);

            return (
              <li key={title.id} className={styles.cell}>
                {/* The poster is the answer to "ماذا شاهدت؟": one tap marks it
                    (UX_AUDIT_MOBILE_2026-09-05 P1 #16 -- this screen used to
                    ask a visual question with text cards and English
                    paragraphs). After the server confirms it, the film moves
                    to the library's watch history instead of occupying a
                    discovery slot. */}
                <div className={styles.tile}>
                  <button
                    type="button"
                    className={styles.pick}
                    aria-pressed="false"
                    aria-label={t.markWatchedOf(name)}
                    onClick={() => setState(title, 'watched', t.watchedNotice)}
                    disabled={busy}
                  >
                    <Poster title={title} size="md" className={styles.poster} name={name} />
                  </button>

                  {/* Keep the watched action in its own corner so the film
                      name remains the strongest content over the scrim. On
                      the narrow three-column layout the word is visually
                      hidden, while the button's accessible name stays full. */}
                  <span className={styles.pickHint} aria-hidden="true">
                    {busy ? (
                      '…'
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span className={styles.pickHintLabel}>{t.watched}</span>
                      </>
                    )}
                  </span>

                  <div className={styles.posterMeta}>
                    <h4 className={styles.title}>
                      {onOpenTitle ? (
                        <button type="button" className={styles.titleButton} onClick={() => onOpenTitle(title, state ?? null, { query, browseAll, genre, pagesLoaded: page })}>
                          {name}
                        </button>
                      ) : (
                        name
                      )}
                    </h4>
                    {title.releaseYear && <span className={styles.year}>{String(title.releaseYear)}</span>}
                  </div>

                  {/* Saving for later is a second, smaller intent; it keeps its
                      own target rather than hiding behind a long press, which
                      the interaction addendum rules out. */}
                  <button
                    type="button"
                    className={listed ? `${styles.saveLater} ${styles.saved}` : styles.saveLater}
                    aria-pressed={listed}
                    aria-label={listed ? t.onListOf(name) : t.laterOf(name)}
                    onClick={() => setState(title, listed ? 'not_watched' : 'watchlist', listed ? t.undoNotice : t.laterNotice)}
                    disabled={busy}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={listed ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
                      <path d="M7 4h10v16l-5-3.5L7 20z" />
                    </svg>
                  </button>
                </div>
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
          onClick={() => { setBrowseAll((current) => !current); setGenre(null); setPagesToRestore(1); }}
          disabled={searching}
        >
          {browseAll ? t.backToStarter : t.browseAll}
        </button>
      )}
    </div>
  );
}
