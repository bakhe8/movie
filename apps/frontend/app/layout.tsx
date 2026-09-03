import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "./lib/session";

export const metadata: Metadata = {
  title: "Movie Taste Lab",
  description: "Personalized film recommendations from triadic rankings.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
