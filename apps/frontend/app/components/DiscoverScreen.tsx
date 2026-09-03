'use client';

import { useEffect, useState } from 'react';
import { api, type Title } from '../lib/api';

const labels = {
  ar: {
    title: 'اكتشف',
    search: 'ابحث عن فيلم',
    watched: 'شاهدته',
    marked: 'مُسجَّل كمشاهَد',
    empty: 'لا نتائج. جرّب بحثًا آخر.',
    loading: 'جارٍ البحث…',
  },
  en: {
    title: 'Discover',
    search: 'Search films',
    watched: 'Watched',
    marked: 'Marked as watched',
    empty: 'No results. Try another search.',
    loading: 'Searching…',
  },
};

export function DiscoverScreen({ lang, profileId }: { lang: 'ar' | 'en'; profileId: string }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Title[]>([]);
  const [loading, setLoading] = useState(false);
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set());
  const t = labels[lang];

  useEffect(() => {
    let cancelled = false;
    // Flip the loading indicator on immediately (before the debounce/fetch
    // below resolves) rather than only after an await -- there is no
    // external-system equivalent to "subscribe" to here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .listTitles(search)
        .then((page) => {
          if (!cancelled) {
            setResults(page.items);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  async function markWatched(titleId: string) {
    await api.setTitleState(profileId, titleId, { state: 'watched' });
    setMarkedIds((current) => new Set(current).add(titleId));
  }

  return (
    <>
      <h2>{t.title}</h2>
      <input
        className="search"
        placeholder={t.search}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {loading ? (
        <p className="muted">{t.loading}</p>
      ) : results.length === 0 ? (
        <p className="muted">{t.empty}</p>
      ) : (
        <div className="results">
          {results.map((title) => {
            const isMarked = markedIds.has(title.id);
            return (
              <article key={title.id}>
                <div>
                  <h3>{lang === 'ar' ? title.titleAr : title.titleEn}</h3>
                  <p>{title.description}</p>
                </div>
                <button
                  className="cta"
                  disabled={isMarked}
                  onClick={() => markWatched(title.id)}
                >
                  {isMarked ? t.marked : t.watched}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
