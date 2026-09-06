import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminShell } from '../components/admin/AdminShell';

let pathname = '/admin/monitoring/catalog';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

// ADMIN-W2 (plan §11): the monitoring/administration split must be visible
// and correctly reflect the current route, on every surface the shell
// renders (mobile section nav and desktop sidebar both read the same
// pathname).
describe('AdminShell', () => {
  it('marks the monitoring area and its current section active from the pathname', () => {
    pathname = '/admin/monitoring/models';
    render(<AdminShell><p>content</p></AdminShell>);

    const monitoringSwitch = screen.getByRole('link', { name: 'المراقبة' });
    expect(monitoringSwitch).toHaveAttribute('aria-current', 'page');
    const modelsLinks = screen.getAllByRole('link', { name: 'أداء نظام التوصيات' });
    expect(modelsLinks.every((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('marks the administration area active and shows only its own sections', () => {
    pathname = '/admin/administration/review';
    render(<AdminShell><p>content</p></AdminShell>);

    const administrationSwitch = screen.getByRole('link', { name: 'الإدارة' });
    expect(administrationSwitch).toHaveAttribute('aria-current', 'page');
    // The mobile/tablet section nav shows only the active area's sections --
    // "الكتالوج" (a monitoring-only section) must not appear there, only in
    // the desktop sidebar's separate monitoring group.
    const catalogLinks = screen.getAllByRole('link', { name: 'الكتالوج' });
    expect(catalogLinks).toHaveLength(1);
  });

  it('renders the passed page content', () => {
    pathname = '/admin/monitoring/catalog';
    render(<AdminShell><p>محتوى الصفحة</p></AdminShell>);
    expect(screen.getByText('محتوى الصفحة')).toBeInTheDocument();
  });
});
