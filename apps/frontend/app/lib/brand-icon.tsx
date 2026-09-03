import { ImageResponse } from 'next/og';

// Renders the same mark AppShell.module.css's `.mark` class draws in the
// header (accent-filled rounded square, bold white "R") at whatever size a
// PWA icon route needs. Placeholder standing in for the two-version
// (light/dark) logo decided but not yet designed
// (docs/IDENTITY_DECISIONS_2026-09-03.md Q23) -- swap this out once that
// asset exists rather than inventing a different mark here.
export function renderBrandIcon(size: number, { maskable = false }: { maskable?: boolean } = {}) {
  // Maskable icons must fill the canvas edge to edge (the OS applies its own
  // mask shape) and keep content inside the ~80% "safe zone" so nothing gets
  // clipped; a normal ("any") icon keeps the header mark's own rounding.
  const radius = maskable ? 0 : Math.round(size * 0.3);
  const glyphSize = maskable ? Math.round(size * 0.42) : Math.round(size * 0.5);

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b7a70',
          borderRadius: radius,
        }}
      >
        <span
          style={{
            color: '#fff',
            fontSize: glyphSize,
            fontWeight: 900,
            fontFamily: 'sans-serif',
            lineHeight: 1,
          }}
        >
          R
        </span>
      </div>
    ),
    { width: size, height: size },
  );
}
