'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ConfirmEmailScreen } from './ConfirmEmailScreen';

// The token and the language both travel in the query string (same as
// /reset-password), so this is a client route; `useSearchParams` needs a
// Suspense boundary to prerender.
function ConfirmEmailRoute() {
  const params = useSearchParams();
  const token = params.get('token')?.trim() || null;
  const lang = params.get('lang') === 'en' ? 'en' : 'ar';
  return <ConfirmEmailScreen token={token} lang={lang} />;
}

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmailRoute />
    </Suspense>
  );
}
