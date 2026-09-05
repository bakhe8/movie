import type { MetadataRoute } from 'next';

// Installable PWA shell (BP §5.1–§5.2, ADR-5). Icons draw the Kolme triad
// mark (O-13أ, ADR-111) -- see app/lib/brand-icon.tsx.
// background_color/theme_color use the light-theme tokens (styles/tokens.css)
// since a manifest carries only one static pair; the HTML <head> separately
// declares a dark-aware theme-color via the `viewport` export in layout.tsx.
// No `lang`, and `dir: 'auto'`: the app runs in Arabic or English at the
// user's choice (app/page.tsx keeps <html lang/dir> in step), but this route
// is static and cannot see that choice, and its own strings are English --
// so it declares neither language and lets the OS derive direction from the
// text it is given (AUDIT_2026-09-05 M7).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kolme',
    short_name: 'Kolme',
    description: 'Personalized film recommendations from triadic rankings.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f6fc',
    theme_color: '#2445e8',
    dir: 'auto',
    categories: ['entertainment'],
    icons: [
      { src: '/icon-192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512-maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
