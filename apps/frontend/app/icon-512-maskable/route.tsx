import { renderBrandIcon } from '../lib/brand-icon';

export function GET() {
  return renderBrandIcon(512, { maskable: true });
}
