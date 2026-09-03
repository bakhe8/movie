'use client';

import { useEffect, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { DiscoverScreen } from './components/DiscoverScreen';
import { ListScreen } from './components/ListScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { RankScreen } from './components/RankScreen';
import { RecommendationsScreen } from './components/RecommendationsScreen';
import { useSession } from './lib/session';

type View = 'home' | 'rank' | 'discover' | 'list' | 'profile';

const labels = {
  ar: { home: 'الرئيسية', rank: 'رتّب', discover: 'اكتشف', list: 'قائمتي', profile: 'الملف الشخصي' },
  en: { home: 'Home', rank: 'Rank', discover: 'Discover', list: 'My list', profile: 'Profile' },
};

export default function Home() {
  const { ready, user, profile } = useSession();
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [view, setView] = useState<View>('home');
  const t = labels[lang];

  // Keep the document's language and direction in step with the UI language
  // so assistive tech, fonts and layout follow the toggle (blueprint §4.3 RTL).
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  if (!ready) {
    return null;
  }

  if (!user) {
    return <AuthScreen lang={lang} />;
  }

  if (!profile) {
    return <p className="muted">{lang === 'ar' ? 'جارٍ إعداد ملفك…' : 'Setting up your profile…'}</p>;
  }

  return (
    <main className="app" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header>
        <div className="brand">
          <span>R</span>Reel
        </div>
        <button className="language" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
          {lang === 'ar' ? 'EN' : 'عربي'}
        </button>
      </header>
      <section className="content">
        {/* Home is "tonight's decision" (blueprint §5.3): the recommendation
            tracks, or the honest "still learning" state before a model exists. */}
        {view === 'home' && (
          <RecommendationsScreen lang={lang} profileId={profile.id} onGoToRank={() => setView('rank')} />
        )}
        {view === 'rank' && <RankScreen lang={lang} profileId={profile.id} />}
        {view === 'discover' && (
          <DiscoverScreen lang={lang} profileId={profile.id} onGoToRank={() => setView('rank')} />
        )}
        {view === 'list' && <ListScreen lang={lang} profileId={profile.id} />}
        {view === 'profile' && <ProfileScreen lang={lang} />}
      </section>
      <nav>
        {(['home', 'rank', 'discover', 'list', 'profile'] as View[]).map((item) => (
          <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>
            {t[item]}
          </button>
        ))}
      </nav>
    </main>
  );
}
