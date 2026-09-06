import { describe, expect, it } from 'vitest';
import { ADMIN_CAPABILITIES, capabilitiesForRole } from './admin-capabilities';

// ADMIN-W1 (ADR-117 "Compatibility"): the legacy admin role is a temporary
// stand-in for every capability, not a hardcoded UI list -- this guards the
// mapping stays exhaustive as ADMIN_CAPABILITIES grows, and that nothing
// else silently gains access.
describe('capabilitiesForRole', () => {
  it('grants the legacy admin role every current capability', () => {
    expect(capabilitiesForRole('admin').sort()).toEqual([...ADMIN_CAPABILITIES].sort());
  });

  it('grants a plain user no capabilities at all', () => {
    expect(capabilitiesForRole('user')).toEqual([]);
  });

  it('grants an unrecognized role nothing rather than failing open', () => {
    expect(capabilitiesForRole('superadmin')).toEqual([]);
    expect(capabilitiesForRole('')).toEqual([]);
  });
});
