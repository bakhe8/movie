import type { Metadata } from "next";
import Script from "next/script";
import localFont from "next/font/local";
import "./globals.css";
import "./styles/tokens.css";
import { SessionProvider } from "./lib/session";
import { ThemeProvider } from "./lib/theme";
import { ServiceWorkerRegistration } from "./lib/ServiceWorkerRegistration";

export const metadata: Metadata = {
  title: "Reel",
  description: "Personalized film recommendations from triadic rankings.",
};

// Fonts (docs/IDENTITY_DECISIONS_2026-09-03.md Q9): one bilingual family for
// the UI, a display face for large headings only. The files live in
// app/fonts/ with their OFL licence text, so a build needs no network:
// next/font/google fetched them from Google at every build (ADR-94). Exposed
// as CSS variables that styles/tokens.css turns into --font-ui and
// --font-display.
const plexArabic = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-arabic",
  display: "swap",
});
// One variable file, instanced to the 500-700 range Q9 uses (HEXP pinned).
const readex = localFont({
  src: "./fonts/readex-pro/ReadexPro-VF.woff2",
  weight: "500 700",
  style: "normal",
  variable: "--font-readex",
  display: "swap",
});

// Arabic-first (blueprint §2, §5.1): the document defaults to Arabic/RTL and
// app/page.tsx keeps `lang`/`dir` in sync when the user toggles the UI language.
// Theme (decisions Q1): `data-theme` is set before first paint by BOOT_SCRIPT
// from the stored preference, or left absent so CSS follows the system;
// `suppressHydrationWarning` covers that pre-hydration attribute.
export default function RootLayout({ children }: { children: import('react').ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${plexArabic.variable} ${readex.variable}`} suppressHydrationWarning>
      <head>
        {/* Runs before hydration so a saved theme never flashes (Q1). An
            external file, not inline: React warns about inline <script>
            elements in the component tree. Source: public/theme-boot.js. */}
        <Script src="/theme-boot.js" strategy="beforeInteractive" />
      </head>
      <body>
        <ThemeProvider>
          <SessionProvider>{children}</SessionProvider>
        </ThemeProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
