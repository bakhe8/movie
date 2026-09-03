'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from './lib/api';
import { AppShell, type View } from './components/AppShell';
import { AuthScreen } from './components/AuthScreen';
import { DiscoverScreen } from './components/DiscoverScreen';
import { ListScreen } from './components/ListScreen';
import { OnboardingScreen } from './components/OnboardingScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { RankScreen } from './components/RankScreen';
import { RecommendationsScreen } from './components/RecommendationsScreen';
import { useSession } from './lib/session';

export default function Home() {
  const { ready, user, profile, refreshProfile } = useSession();
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [view, setView] = useState<View>('home');
  // Onboarding (blueprint §4.1) starts when a profile arrives with no market
  // and stays open until its last step (or "later") -- step 1 saves the
  // market, so the flow cannot be keyed on the market alone. "Later" hides it
  // for this session only; with the market still unset it returns next time.
  const [onboarding, setOnboarding] = useState<'unknown' | 'active' | 'done'>('unknown');
  // A language chosen at the door (before sign-in) is the user's most recent
  // explicit choice; it wins over the profile's saved preference on arrival.
  const doorChoice = useRef<'ar' | 'en' | null>(null);

  // Keep the document's language and direction in step with the UI language
  // so assistive tech, fonts and layout follow the toggle (blueprint §4.3 RTL).
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  // The profile's saved language preference (profile screen) is the default
  // UI language; the header toggle stays a per-session override on top of
  // it. Keyed on the preference value alone, so a profile refresh that does
  // not change the preference never undoes the toggle.
  const preferredLanguage = profile?.preferredLanguage;
  useEffect(() => {
    if (!preferredLanguage) return;
    if (doorChoice.current) {
      doorChoice.current = null;
      return;
    }
    setLang(preferredLanguage);
  }, [preferredLanguage]);

  const profileMarket = profile?.market;
  const profileId = profile?.id;
  useEffect(() => {
    if (!profileId || onboarding !== 'unknown') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnboarding(profileMarket === null ? 'active' : 'done');
  }, [profileId, profileMarket, onboarding]);

  if (!ready) {
    return null;
  }

  if (!user) {
    return (
      <AuthScreen
        lang={lang}
        onLanguageChange={(next) => {
          doorChoice.current = next;
          setLang(next);
        }}
      />
    );
  }

  if (!profile) {
    return <p className="muted">{lang === 'ar' ? 'جارٍ إعداد ملفك…' : 'Setting up your profile…'}</p>;
  }

  // M9: the header toggle used to be a local-only preview -- profile.preferredLanguage
  // never changed, so a reload silently reverted it. Flips immediately for a snappy
  // toggle, then persists the same way the profile screen's language field does
  // (PATCH + refreshProfile); a failed PATCH is left uncorrected for this session
  // rather than reverted (blueprint §4.1 binds language to the profile, but M4's
  // "don't destroy state on a transient error" applies here too) -- the next reload
  // falls back to whatever was last actually saved.
  const currentProfileId = profile.id;
  async function toggleLanguage() {
    const next = lang === 'ar' ? 'en' : 'ar';
    setLang(next);
    try {
      await api.updateProfile(currentProfileId, { preferredLanguage: next });
      await refreshProfile();
    } catch {
      // Transient failure -- this session keeps showing `next`; unchanged on the server.
    }
  }

  if (onboarding === 'active') {
    return (
      <AppShell lang={lang} onToggleLanguage={toggleLanguage}>
        <OnboardingScreen
          lang={lang}
          onLanguageChange={setLang}
          onDone={() => {
            setOnboarding('done');
            setView('discover');
          }}
          onSkip={() => setOnboarding('done')}
        />
      </AppShell>
    );
  }

  return (
    <AppShell lang={lang} onToggleLanguage={toggleLanguage} view={view} onNavigate={setView}>
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
      {view === 'profile' && <ProfileScreen lang={lang} onLanguageChange={setLang} />}
    </AppShell>
  );
}
