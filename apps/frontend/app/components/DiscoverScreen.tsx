'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type Title, type TitleState } from '../lib/api';
import { formatNumber } from '../lib/format';
import { Poster } from './Poster';
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
    title: 'ماذا شاهدت؟',
    // Blueprint §4.2: quick picks from known titles, plus search; the start
    // must not become a long data-entry task.
    hint: 'اختر بسرعة من عناوين معروفة أو ابحث عنها. ثلاثة أفلام تكفي للبدء، وتوسّع سجلك لاحقًا أثناء الاستخدام.',
    searchLabel: 'ابحث بالاسم العربي أو الإنجليزي',
    searchPlaceholder: 'مثال: الوصول، Arrival',
    progress: (count: string) => `سجّلت ${count} كمُشاهَدة`,
    progressUnit: (n: number) => (n === 1 ? 'فيلمًا واحدًا' : n === 2 ? 'فيلمين' : `${formatNumber(n, 'ar')} أفلام`),
    needMore: (n: number) =>
      n === 1 ? 'بقي فيلم واحد لفتح الترتيب.' : n === 2 ? 'بقي فيلمان لفتح الترتيب.' : 'بقيت ثلاثة أفلام لفتح الترتيب.',
    unlocked: 'الترتيب متاح. كل فيلم إضافي يحسّن جولاتك.',
    goRank: 'إلى الترتيب',
    starter: 'عناوين للبدء',
    starterHint: 'مختارة لتنويع الأنواع والسنوات، لا بحسب ذوقك، فلا نعرفه بعد.',
    browseAll: 'تصفّح الكتالوج كاملًا',
    catalogue: (count: string) => `الكتالوج كاملًا: ${count}`,
    backToStarter: 'العودة إلى عناوين البدء',
    results: (count: string) => `نتائج البحث: ${count}`,
    noResults: 'لا نتائج. جرّب اسمًا آخر أو الاسم بلغة أخرى.',
    more: 'عرض المزيد',
    watched: 'شاهدته',
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
    title: 'What have you watched?',
    hint: 'Pick quickly from known titles or search for them. Three films are enough to start; you can grow your log later as you go.',
    searchLabel: 'Search by Arabic or English title',
    searchPlaceholder: 'e.g. Arrival, الوصول',
    progress: (count: string) => `You have marked ${count} as watched`,
    progressUnit: (n: number) => (n === 1 ? 'one film' : `${formatNumber(n, 'en')} films`),
    needMore: (n: number) => (n === 1 ? 'One more film unlocks ranking.' : `${n === 2 ? 'Two' : 'Three'} more films unlock ranking.`),
    unlocked: 'Ranking is unlocked. Every extra film improves your rounds.',
    goRank: 'Go to ranking',
    starter: 'Titles to start with',
    starterHint: 'Picked to spread genres and years, not by your taste -- we do not know it yet.',
    browseAll: 'Browse the whole catalogue',
    catalogue: (count: string) => `Whole catalogue: ${count}`,
    backToStarter: 'Back to the starter titles',
    results: (count: string) => `Search results: ${count}`,
    noResults: 'No results. Try another name, or the name in the other language.',
    more: 'Show more',
    watched: 'Watched it',
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
          if (!cancelled) setNotice(t.loadFailed);
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
      setNotice(t.loadFailed);
    } finally {
      setSearching(false);
    }
  }

  // The only writes on this screen are exposure/list states -- never a
  // rating of any kind (blueprint §2.4 #2, ADR-4).
  async function setState(title: Title, state: TitleState, noticeFor: (name: string) => string) {
    const name = lang === 'ar' ? title.titleAr : title.titleEn;
    setBusyId(title.id);
    try {
      await api.setTitleState(profileId, title.id, { state });
      setStates((current) => {
        const next = new Map(current);
        if (state === 'not_watched') next.delete(title.id);
        else next.set(title.id, state);
        return next;
      });
      setNotice(noticeFor(name));
    } catch {
      setNotice(t.actionFailed);
    } finally {
      setBusyId(null);
    }
  }

  const watchedCount = [...states.values()].filter((state) => state === 'watched').length;
  const remaining = Math.max(0, UNLOCK_COUNT - watchedCount);
  const isSearch = query.trim().length > 0;

  const header = (
    <div className={styles.header}>
      <p className={styles.eyebrow}>{t.eyebrow}</p>
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

      {notice && (
        <p className={styles.status} role="status">
          {notice}
        </p>
      )}

      <div className={styles.search}>
        <label htmlFor="discover-search">{t.searchLabel}</label>
        <input
          id="discover-search"
          type="search"
          placeholder={t.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </div>

      <h3 className={styles.sectionTitle}>
        {isSearch ? t.results(formatNumber(total, lang)) : browseAll ? t.catalogue(formatNumber(total, lang)) : t.starter}
      </h3>
      {!isSearch && !browseAll && <p className={styles.progressNote}>{t.starterHint}</p>}

      {results.length === 0 && !searching ? (
        <p className={styles.empty}>{t.noResults}</p>
      ) : (
        <ul className={styles.list} aria-busy={searching}>
          {results.map((title) => {
            const name = lang === 'ar' ? title.titleAr : title.titleEn;
            // The other language's title helps recognise a film the user knows
            // under a different name (alternate-title search is a backend gap).
            const alt = lang === 'ar' ? title.titleEn : title.titleAr;
            const meta = [title.releaseYear, title.genres?.join(' · ')].filter(Boolean).join(' · ');
            const state = states.get(title.id);
            const busy = busyId === title.id;

            return (
              <li key={title.id} className={state === 'watched' ? `${styles.card} ${styles.cardWatched}` : styles.card}>
                <div className={styles.cardHead}>
                  <Poster title={title} size="md" />
                  <div className={styles.cardBody}>
                  <h4 className={styles.title}>
                    {onOpenTitle ? (
                      <button type="button" className={styles.titleButton} onClick={() => onOpenTitle(title, state ?? null)}>
                        {name}
                      </button>
                    ) : (
                      name
                    )}
                  </h4>
                  {alt && alt !== name && <p className={styles.alt}>{alt}</p>}
                  {meta && <p className={styles.meta}>{meta}</p>}
                  {/* Catalogue descriptions arrive in their own language: direction from the text. */}
                  {title.description && (
                    <p className={styles.desc} dir="auto">
                      {title.description}
                    </p>
                  )}
                  </div>
                </div>
                <div className={styles.actions}>
                  {state === 'watched' ? (
                    <>
                      <span className={styles.chip}>{t.watchedChip}</span>
                      {/* Undo returns the title to "exposure unknown" -- never
                          a negative signal (blueprint §2.4 #3). */}
                      <button
                        type="button"
                        className={styles.ghost}
                        onClick={() => setState(title, 'not_watched', t.undoNotice)}
                        disabled={busy}
                      >
                        {t.undo}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={() => setState(title, 'watched', t.watchedNotice)}
                        disabled={busy}
                      >
                        {t.watched}
                      </button>
                      <button
                        type="button"
                        className={styles.ghost}
                        onClick={() => setState(title, 'watchlist', t.laterNotice)}
                        disabled={busy || state === 'watchlist'}
                      >
                        {state === 'watchlist' ? t.onList : t.later}
                      </button>
                    </>
                  )}
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
          onClick={() => setBrowseAll((current) => !current)}
          disabled={searching}
        >
          {browseAll ? t.backToStarter : t.browseAll}
        </button>
      )}
    </div>
  );
}
