import type { Metadata } from "next";
import Script from "next/script";
import { IBM_Plex_Sans_Arabic, Readex_Pro } from "next/font/google";
import "./globals.css";
import "./styles/tokens.css";
import { SessionProvider } from "./lib/session";
import { ThemeProvider } from "./lib/theme";

export const metadata: Metadata = {
  title: "Reel",
  description: "Personalized film recommendations from triadic rankings.",
};

// Fonts (docs/IDENTITY_DECISIONS_2026-09-03.md Q9): one bilingual family for
// the UI, a display face for large headings only. Self-hosted by next/font;
// exposed as CSS variables that styles/tokens.css turns into --font-ui and
// --font-display.
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});
const readex = Readex_Pro({
  subsets: ["arabic", "latin"],
  weight: ["500", "600", "700"],
  variable: "--font-readex",
  display: "swap",
});

// Arabic-first (blueprint §2, §5.1): the document defaults to Arabic/RTL and
// app/page.tsx keeps `lang`/`dir` in sync when the user toggles the UI language.
// Theme (decisions Q1): `data-theme` is set before first paint by BOOT_SCRIPT
// from the stored preference, or left absent so CSS follows the system;
// `suppressHydrationWarning` covers that pre-hydration attribute.
export default function RootLayout({ children }: LayoutProps<"/">) {
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
      </body>
    </html>
  );
}
