import type { MetadataRoute } from 'next';

// Installable PWA shell (BP §5.1–§5.2, ADR-5). Icons are placeholders for
// the two-version logo decided but not yet designed
// (docs/IDENTITY_DECISIONS_2026-09-03.md Q23) -- see app/lib/brand-icon.tsx.
// background_color/theme_color use the light-theme tokens (styles/tokens.css)
// since a manifest carries only one static pair; the HTML <head> separately
// declares a dark-aware theme-color via the `viewport` export in layout.tsx.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Reel',
    short_name: 'Reel',
    description: 'Personalized film recommendations from triadic rankings.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f3f5f5',
    theme_color: '#0b7a70',
    lang: 'ar',
    dir: 'rtl',
    categories: ['entertainment'],
    icons: [
      { src: '/icon-192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512-maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
