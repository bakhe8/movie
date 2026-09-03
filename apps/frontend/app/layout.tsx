import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Movie Taste Lab",
  description: "Personalized film recommendations from triadic rankings.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
