"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body>
        <main
          style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <h1>تعذر إكمال الطلب</h1>
          <p>حدث خطأ غير متوقع. تم تسجيله لمراجعته.</p>
          <button type="button" onClick={retry}>
            إعادة المحاولة
          </button>
        </main>
      </body>
    </html>
  );
}
