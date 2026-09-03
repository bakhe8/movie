import { renderBrandIcon } from './lib/brand-icon';

// iOS applies its own rounding to the home-screen icon, so this fills edge
// to edge like a maskable icon rather than using the header mark's rounding.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return renderBrandIcon(180, { maskable: true });
}
