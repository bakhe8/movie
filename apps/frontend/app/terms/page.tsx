import type { Metadata } from 'next';
import { LegalPage, resolveLang } from '../legal/LegalPage';

export const metadata: Metadata = {
  title: 'Reel — شروط الاستخدام / Terms of Use',
};

// The language comes from `?lang=` (Arabic by default): the app keeps its UI
// language in client state and links here with it.
export default async function TermsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <LegalPage kind="terms" lang={resolveLang(params.lang)} />;
}
