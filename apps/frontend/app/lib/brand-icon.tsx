import { ImageResponse } from 'next/og';

// Renders the Kolme mark -- three cards with the middle one standing taller,
// the same triad app/components/BrandMark.tsx draws in the header -- at
// whatever size a PWA icon route needs (owner decision O-13أ, ADR-111).
//
// Built from plain boxes rather than the component's SVG: this tree is laid
// out by satori inside next/og, and boxes are the shape it renders most
// predictably at icon sizes. Colours are the light-theme accent and its ink
// from app/styles/tokens.css -- an icon file cannot read CSS variables, and a
// PNG in the OS chrome has one fixed appearance, so the light pair is used in
// both themes (the same reason manifest.ts carries one static colour pair).
const ACCENT = '#5b4bd6';
const INK = '#ffffff';

export function renderBrandIcon(size: number, { maskable = false }: { maskable?: boolean } = {}) {
  // Maskable icons must fill the canvas edge to edge (the OS applies its own
  // mask shape) and keep content inside the ~80% "safe zone" so nothing gets
  // clipped; a normal ("any") icon keeps the header mark's own rounding.
  const radius = maskable ? 0 : Math.round(size * 0.3);
  // The triad spans this fraction of the canvas, and one card is a fifth of
  // that width with a gap of the same measure between cards.
  const span = Math.round(size * (maskable ? 0.42 : 0.54));
  const card = Math.round(span / 5);
  const gap = card;
  const tall = Math.round(span * 0.9);
  const short = Math.round(tall * 0.66);

  function Card({ height }: { height: number }) {
    return (
      <div
        style={{
          width: card,
          height,
          borderRadius: Math.max(1, Math.round(card * 0.3)),
          background: INK,
        }}
      />
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap,
          background: ACCENT,
          borderRadius: radius,
        }}
      >
        <Card height={short} />
        <Card height={tall} />
        <Card height={short} />
      </div>
    ),
    { width: size, height: size },
  );
}
