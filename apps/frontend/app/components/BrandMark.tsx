/**
 * The Kolme mark: three cards, the middle one standing taller.
 *
 * The name is the product's one question -- rank three films -- so the mark
 * is that triad rather than an initial (owner decision O-13أ, 2026-09-05;
 * design direction ADR-111). It draws in `currentColor`, so every place that
 * uses it decides the colour from a token and the mark follows the theme
 * (identity decision Q24). Direction-neutral: nothing in it points
 * start-or-end, so it never mirrors in RTL (Q22).
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="6" width="6" height="12" rx="1.5" />
      <rect x="9" y="3" width="6" height="18" rx="1.5" />
      <rect x="16" y="6" width="6" height="12" rx="1.5" />
    </svg>
  );
}
