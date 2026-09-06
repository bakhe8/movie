'use client';

import '../../styles/admin-tokens.css';
import { AdminAccessBoundary } from './AdminAccessBoundary';
import { AdminShell } from './AdminShell';

// ADMIN-W2 (ADR-117): the light-token scope wraps the access boundary too --
// "checking"/"forbidden"/etc. are part of the admin experience and must
// never borrow the consumer's active theme/appearance while they render
// (the boundary mounts before AdminShell's own nav chrome exists).
export function AdminShellRoot({ children }: { children: React.ReactNode }) {
  return (
    <div className="adminShell" data-admin-theme="light" style={{ minHeight: '100dvh' }}>
      <AdminAccessBoundary>
        <AdminShell>{children}</AdminShell>
      </AdminAccessBoundary>
    </div>
  );
}
