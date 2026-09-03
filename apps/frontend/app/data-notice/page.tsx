import type { Metadata } from 'next';
import { resolveLang } from '../legal/LegalPage';
import { DataNoticePage } from './DataNoticePage';

export const metadata: Metadata = {
  title: 'Reel — إشعار مرحلة التطوير واستخدام البيانات / Development Notice',
};

// The language comes from `?lang=` (Arabic by default): the app keeps its UI
// language in client state and links here with it.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <DataNoticePage lang={resolveLang(params.lang)} />;
}
