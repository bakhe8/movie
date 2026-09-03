'use client';
import { useState } from 'react';

type View = 'home' | 'rank' | 'discover' | 'list' | 'profile';
type Film = { id: string; title: string; year: number; detail: string; poster: string; runtime: string; rating: string; certificate: string; director: string; cast: string[]; genres: string[] };
const films: Film[] = [
  { id: '1', title: 'Arrival', year: 2016, detail: 'A linguist faces an encounter that changes humanity.', poster: 'https://image.tmdb.org/t/p/w342/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg', runtime: '1h 56m', rating: '94', certificate: 'PG-13', director: 'Denis Villeneuve', cast: ['Amy Adams', 'Jeremy Renner'], genres: ['Drama', 'Sci-Fi'] },
  { id: '2', title: 'The Matrix', year: 1999, detail: 'A hacker discovers that reality is not what it seems.', poster: 'https://image.tmdb.org/t/p/w342/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', runtime: '2h 16m', rating: '88', certificate: 'R', director: 'The Wachowskis', cast: ['Keanu Reeves', 'Laurence Fishburne'], genres: ['Action', 'Sci-Fi'] },
  { id: '3', title: "Pan's Labyrinth", year: 2006, detail: 'A young girl escapes into a dark fairytale.', poster: 'https://image.tmdb.org/t/p/w342/3jO6vW6LkW1X5NfW8Pea8G80w37.jpg', runtime: '1h 59m', rating: '95', certificate: 'R', director: 'Guillermo del Toro', cast: ['Ivana Baquero', 'Sergi Lopez'], genres: ['Fantasy', 'Drama'] },
];
const labels = {
  ar: { home: 'الرئيسية', rank: 'رتّب', discover: 'اكتشف', list: 'قائمتي', profile: 'الملف الشخصي', title: 'رتّب الأفلام بحسب تفضيلك', hint: 'اسحب البطاقات. البطاقة الأولى هي المفضلة.', save: 'حفظ الترتيب', welcome: 'أهلاً بك في Reel', empty: 'أكمل جولات الترتيب للحصول على توصياتك.', search: 'ابحث عن فيلم', saved: 'لم تضف أفلاماً بعد.', account: 'إدارة ملف ذوقك' },
  en: { home: 'Home', rank: 'Rank', discover: 'Discover', list: 'My list', profile: 'Profile', title: 'Order films by preference', hint: 'Drag cards. The first card is your favorite.', save: 'Save ranking', welcome: 'Welcome to Reel', empty: 'Complete ranking rounds for recommendations.', search: 'Search films', saved: 'No saved films yet.', account: 'Manage your taste profile' },
};
export default function Home() {
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [view, setView] = useState<View>('home');
  const [order, setOrder] = useState(films);
  const [search, setSearch] = useState('');
  const t = labels[lang];
  function move(from: number, to: number) {
    if (to < 0 || to >= order.length) return;
    setOrder((current) => { const next = [...current]; const [film] = next.splice(from, 1); next.splice(to, 0, film); return next; });
  }
  return <main className="app" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <header><div className="brand"><span>R</span>Reel</div><button className="language" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'EN' : 'عربي'}</button></header>
    <section className="content">
      {view === 'home' && <><p className="eyebrow">REEL</p><h2>{t.welcome}</h2><p className="muted">{t.empty}</p><button className="cta" onClick={() => setView('rank')}>{t.rank}</button></>}
      {view === 'rank' && <><p className="eyebrow">{t.rank}</p><h2>{t.title}</h2><p className="muted">{t.hint}</p><div className="rank-list">{order.map((film, index) => <article className="rank-card" draggable key={film.id} onDragStart={(event) => event.dataTransfer.setData('index', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => move(Number(event.dataTransfer.getData('index')), index)}><span className="position">{index + 1}</span><img src={film.poster} alt={`${film.title} poster`} /><div><small>{film.year} · {film.runtime} · {film.certificate} · {film.rating}%</small><h3>{film.title}</h3><p className="credits">{film.director} · {film.cast.join(' · ')}</p><p className="genres">{film.genres.join(' · ')}</p><p>{film.detail}</p></div><div className="move"><button onClick={() => move(index, index - 1)} disabled={index === 0}>↑</button><button onClick={() => move(index, index + 1)} disabled={index === order.length - 1}>↓</button></div></article>)}</div><button className="cta full">{t.save}</button></>}
      {view === 'discover' && <><h2>{t.discover}</h2><input className="search" placeholder={t.search} value={search} onChange={(event) => setSearch(event.target.value)} /><div className="results">{films.filter((film) => film.title.toLowerCase().includes(search.toLowerCase())).map((film) => <article key={film.id}><div><h3>{film.title}</h3><p>{film.detail}</p></div><button className="cta" onClick={() => setView('list')}>{lang === 'ar' ? 'شاهدته' : 'Watched'}</button></article>)}</div></>}
      {view === 'list' && <><h2>{t.list}</h2><p className="muted">{t.saved}</p></>}
      {view === 'profile' && <><h2>{t.profile}</h2><p className="muted">{t.account}</p></>}
    </section>
    <nav>{(['home', 'rank', 'discover', 'list', 'profile'] as View[]).map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{t[item]}</button>)}</nav>
  </main>;
}
