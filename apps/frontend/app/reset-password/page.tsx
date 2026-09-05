'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ResetPasswordScreen } from './ResetPasswordScreen';

// The token and the language both travel in the query string, so this is a
// client route; `useSearchParams` needs a Suspense boundary to prerender.
function ResetPasswordRoute() {
  const params = useSearchParams();
  const token = params.get('token')?.trim() || null;
  const lang = params.get('lang') === 'en' ? 'en' : 'ar';
  return <ResetPasswordScreen token={token} lang={lang} />;
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordRoute />
    </Suspense>
  );
}
