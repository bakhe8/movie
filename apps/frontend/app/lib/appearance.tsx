'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type PreferredAppearance } from './api';
import { useSession } from './session';
import { useToast } from './toast';

export type Appearance = PreferredAppearance;
export const APPEARANCES: Appearance[] = ['cinema', 'premiere', 'montage'];
export const APPEARANCE_STORAGE_KEY = 'reel.appearance.v1';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'local' | 'error';
type Lang = 'ar' | 'en';

export function isAppearance(value: unknown): value is Appearance {
  return value === 'cinema' || value === 'premiere' || value === 'montage';
}

export function appearanceStorageKey(profileId: string | null) {
  return `${APPEARANCE_STORAGE_KEY}:${profileId ?? 'guest'}`;
}

function readLocal(profileId: string | null): Appearance {
  try {
    const value = localStorage.getItem(appearanceStorageKey(profileId));
    return isAppearance(value) ? value : 'cinema';
  } catch {
    return 'cinema';
  }
}

function writeLocal(profileId: string | null, appearance: Appearance): boolean {
  try {
    localStorage.setItem(appearanceStorageKey(profileId), appearance);
    return true;
  } catch {
    return false;
  }
}

type AppearanceContextValue = {
  appearance: Appearance;
  selectAppearance: (appearance: Appearance) => void;
  saving: boolean;
  status: SaveStatus;
  profileBacked: boolean;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

type ProviderProps = {
  children: ReactNode;
  profileId?: string | null;
  preferredAppearance?: Appearance | null;
  lang?: Lang;
};

/** Appearance and light/dark remain independent preferences. */
export function AppearanceProvider({ children, profileId = null, preferredAppearance, lang = 'ar' }: ProviderProps) {
  // An account/profile switch invalidates pending responses and queued writes.
  return (
    <AppearanceScope key={profileId ?? 'guest'} profileId={profileId} preferredAppearance={preferredAppearance} lang={lang}>
      {children}
    </AppearanceScope>
  );
}

function AppearanceScope({ children, profileId = null, preferredAppearance, lang = 'ar' }: ProviderProps) {
  const { toast } = useToast();
  const [appearance, setAppearance] = useState<Appearance>(isAppearance(preferredAppearance) ? preferredAppearance : 'cinema');
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const mounted = useRef(false);
  const revision = useRef(0);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingWrite = useRef(false);
  const confirmedAppearance = useRef<Appearance | null>(isAppearance(preferredAppearance) ? preferredAppearance : null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    // Hydration can read browser storage only after the server-matching render.
    // A profile refresh must never replace an explicit choice still saving.
    if (revision.current !== 0) return;
    const next = isAppearance(preferredAppearance) ? preferredAppearance : readLocal(profileId);
    setAppearance(next);
    setHydrated(true);
    if (isAppearance(preferredAppearance)) {
      confirmedAppearance.current = preferredAppearance;
      writeLocal(profileId, preferredAppearance);
    }
  }, [profileId, preferredAppearance]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== appearanceStorageKey(profileId)) return;
      if (event.storageArea && event.storageArea !== localStorage) return;
      // A local explicit selection stays in charge until its write settles.
      // Other profiles never share a preference key; no storage event saves
      // anything back to the API or claims that the other tab saved it there.
      if (pendingWrite.current) return;
      const next = isAppearance(event.newValue) ? event.newValue : confirmedAppearance.current ?? 'cinema';
      ++revision.current;
      setAppearance(next);
      setStatus(profileId || !isAppearance(event.newValue) ? 'idle' : 'local');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [profileId]);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.setAttribute('data-appearance', appearance);
  }, [appearance, hydrated]);

  const selectAppearance = useCallback((next: Appearance) => {
    if (!isAppearance(next)) return;
    const operation = ++revision.current;
    setAppearance(next);
    const remembered = writeLocal(profileId, next);

    if (!profileId) {
      setStatus(remembered ? 'local' : 'error');
      toast(lang === 'ar'
        ? remembered ? 'تغيّر المظهر وحُفظ على هذا الجهاز' : 'تغيّر المظهر لهذه الزيارة؛ تعذّر حفظه على الجهاز'
        : remembered ? 'Appearance saved on this device' : 'Appearance changed for this visit; device storage is unavailable',
      { tone: remembered ? 'success' : 'error' });
      return;
    }

    pendingWrite.current = true;
    setStatus('saving');
    // Serialize writes so a slow earlier request cannot overwrite the latest
    // selection on the server. Superseded queued choices need no request.
    writeQueue.current = writeQueue.current.then(async () => {
      if (!mounted.current || operation !== revision.current) return;
      try {
        const saved = await api.updateProfile(profileId, { preferredAppearance: next });
        if (!mounted.current || operation !== revision.current) return;
        if (saved.preferredAppearance !== next) throw new Error('Appearance was not persisted');
        pendingWrite.current = false;
        confirmedAppearance.current = next;
        writeLocal(profileId, next);
        setStatus('saved');
        toast(lang === 'ar' ? 'حُفظ المظهر في ملفك' : 'Appearance saved to your profile', { tone: 'success' });
      } catch {
        if (!mounted.current || operation !== revision.current) return;
        pendingWrite.current = false;
        setStatus('error');
        toast(lang === 'ar'
          ? 'تغيّر المظهر هنا، لكن تعذّر حفظه في ملفك. أعد المحاولة.'
          : 'Appearance changed here, but could not be saved to your profile. Try again.', { tone: 'error' });
      }
    });
  }, [lang, profileId, toast]);

  const value = useMemo(() => ({ appearance, selectAppearance, saving: status === 'saving', status, profileBacked: Boolean(profileId) }),
    [appearance, selectAppearance, status, profileId]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

/** Mount inside SessionProvider and ToastProvider in the shared layout. */
export function SessionAppearanceProvider({ children }: { children: ReactNode }) {
  const { profile, user } = useSession();
  // Session transitions can briefly expose the previous profile. Never use it
  // for the new account's display preference or a subsequent preference write.
  const activeProfile = user && profile?.userId === user.id ? profile : null;
  return (
    <AppearanceProvider profileId={activeProfile?.id ?? null} preferredAppearance={activeProfile?.preferredAppearance} lang={activeProfile?.preferredLanguage ?? 'ar'}>
      {children}
    </AppearanceProvider>
  );
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('useAppearance must be used inside AppearanceProvider');
  return context;
}
