// ADR-117's target capability vocabulary (ADMIN-W1). Routes still enforce the
// legacy `role === 'admin'` gate via AdminGuard; this mapping only lets the
// frontend render/hide sections honestly ahead of per-operation enforcement
// (W4). The server-side check remains the security boundary either way.
export const ADMIN_CAPABILITIES = [
  'admin.monitor',
  'audit.read',
  'catalog.manage',
  'fingerprints.review',
  'models.manage',
  'users.manage',
  'jobs.manage',
  'settings.manage',
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

// Compatibility mapping (ADR-117 "Compatibility"): the legacy admin role
// temporarily grants every capability. Unknown or non-admin roles grant
// none -- AdminGuard already denies them before this runs, but a context
// call must never invent access for a role it does not recognize.
export function capabilitiesForRole(role: string): AdminCapability[] {
  return role === 'admin' ? [...ADMIN_CAPABILITIES] : [];
}
