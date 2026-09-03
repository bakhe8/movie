import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "./lib/session";

export const metadata: Metadata = {
  title: "Reel",
  description: "Personalized film recommendations from triadic rankings.",
};

// Arabic-first (blueprint §2, §5.1): the document defaults to Arabic/RTL and
// app/page.tsx keeps `lang`/`dir` in sync when the user toggles the UI language.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
