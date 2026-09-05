/**
 * The rating star (owner's addendum 3, 2026-09-05: where an expression is
 * already understood, the symbol carries it and the words step back).
 *
 * A star beside a number is the one rating idiom every catalogue uses, so the
 * scale ("out of 10") stops being spelled out. What stays in words is the
 * source and the day it was read, because those are facts, not decoration --
 * and the star itself is `aria-hidden`: the cell it sits in is already named
 * "الجودة العامة" for anyone who is listening rather than looking.
 */
export function RatingStar({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z" />
    </svg>
  );
}
