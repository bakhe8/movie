import type { Metadata } from 'next';
import { LegalPage, resolveLang } from '../legal/LegalPage';

export const metadata: Metadata = {
  title: 'Kolme — إشعار الخصوصية / Privacy Notice',
};

// The language comes from `?lang=` (Arabic by default): the app keeps its UI
// language in client state and links here with it.
export default async function PrivacyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <LegalPage kind="privacy" lang={resolveLang(params.lang)} />;
}
