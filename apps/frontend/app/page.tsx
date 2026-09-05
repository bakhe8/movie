'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type Title, type TitleState } from './lib/api';
import { AppShell, type View } from './components/AppShell';
import { AuthScreen } from './components/AuthScreen';
import { DiscoverScreen } from './components/DiscoverScreen';
import { ListScreen } from './components/ListScreen';
import { OnboardingScreen } from './components/OnboardingScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { RankScreen } from './components/RankScreen';
import { RecommendationsScreen } from './components/RecommendationsScreen';
import { WorkScreen, type WorkContext } from './components/WorkScreen';
import { useSession } from './lib/session';
import { LoadingScene } from './components/LoadingScene';

export default function Home() {
  const { ready, user, profile, refreshProfile } = useSession();
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [view, setView] = useState<View>('home');
  // The work page (blueprint §5.3) opens over the current section from a
  // card, carrying that card's context; any tab or "back" closes it.
  const [work, setWork] = useState<{ title: Title; context: WorkContext; state: TitleState | null } | null>(null);
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
    return <LoadingScene lang={lang} />;
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

  // Until the onboarding decision is made (one effect pass after the profile
  // arrives), render the same placeholder instead of the signed-in shell:
  // rendering `home` here mounted RecommendationsScreen for a user who was
  // about to see onboarding, firing recommendation/list requests (and their
  // designed 409 "no model yet" replies) that the user never asked for.
  if (!profile || onboarding === 'unknown') {
    // Tokens only (globals.css no longer carries utility classes).
    return (
      <LoadingScene lang={lang} />
    );
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
          // Identity decision Q18: a new user lands on the triad -- the
          // product's one question -- not on a catalogue. The triad screen
          // itself explains the watched-set gate (blueprint §4.1) and offers
          // the one tap to Discover when it cannot be drawn yet.
          onDone={(destination) => {
            setOnboarding('done');
            setView(destination);
          }}
          onSkip={(destination) => {
            setOnboarding('done');
            setView(destination);
          }}
        />
      </AppShell>
    );
  }

  function navigate(next: View) {
    setWork(null);
    setView(next);
  }

  return (
    <AppShell lang={lang} onToggleLanguage={toggleLanguage} view={view} sceneKey={work?.title.id ?? view} onNavigate={navigate}>
      {work ? (
        <WorkScreen
          lang={lang}
          profileId={profile.id}
          title={work.title}
          context={work.context}
          initialState={work.state}
          onBack={() => setWork(null)}
        />
      ) : (
        <>
          {/* Home is "tonight's decision" (blueprint §5.3): the recommendation
              tracks, or the honest "still learning" state before a model exists. */}
          {view === 'home' && (
            <RecommendationsScreen
              lang={lang}
              profileId={profile.id}
              onGoToRank={() => setView('rank')}
              onGoToDiscover={() => setView('discover')}
              onOpenTitle={(recommendation, position, count, listed) =>
                setWork({
                  title: recommendation.title,
                  context: { kind: 'recommendation', recommendation, position, count },
                  state: listed ? 'watchlist' : null,
                })
              }
            />
          )}
          {view === 'rank' && (
            <RankScreen lang={lang} profileId={profile.id} onGoToDiscover={() => setView('discover')} />
          )}
          {view === 'discover' && (
            <DiscoverScreen
              lang={lang}
              profileId={profile.id}
              onGoToRank={() => setView('rank')}
              onOpenTitle={(title, state) => setWork({ title, context: { kind: 'none' }, state })}
            />
          )}
          {view === 'list' && (
            <ListScreen
              lang={lang}
              profileId={profile.id}
              onOpenCatalogTitle={(title, state) => setWork({ title, context: { kind: 'none' }, state })}
              onOpenTitle={(item, count) =>
                setWork({ title: item.title, context: { kind: 'ranking', item, position: item.position, count }, state: 'watched' })
              }
            />
          )}
          {view === 'profile' && <ProfileScreen lang={lang} onLanguageChange={setLang} />}
        </>
      )}
    </AppShell>
  );
}
