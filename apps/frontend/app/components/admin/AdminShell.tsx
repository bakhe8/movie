'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_SECTION_COPY } from './admin-copy';
import s from './AdminShell.module.css';

// ADMIN-W2/W3 (ADR-117 "Decision — separation"): the target IA (plan §11)
// split into two areas. Monitoring is read-only; only Administration ever
// imports a mutation client. W3 completes monitoring's read surface (every
// admin GET route now has a destination -- plan §18 W3 closing gate).
// Labels come from admin-copy.ts (owner feedback 2026-09-06: nav must read
// as plain operator language, not engineering terms) -- one title per
// destination, kept in sync with each page's own heading and blurb.
const MONITORING_SECTIONS = [
  { href: '/admin/monitoring/overview', label: ADMIN_SECTION_COPY.overview.title },
  { href: '/admin/monitoring/catalog', label: ADMIN_SECTION_COPY.catalog.title },
  { href: '/admin/monitoring/reviews', label: ADMIN_SECTION_COPY.reviews.title },
  { href: '/admin/monitoring/models', label: ADMIN_SECTION_COPY.models.title },
  { href: '/admin/monitoring/operations', label: ADMIN_SECTION_COPY.operations.title },
  { href: '/admin/monitoring/jobs', label: ADMIN_SECTION_COPY.jobs.title },
  { href: '/admin/monitoring/settings', label: ADMIN_SECTION_COPY.settings.title },
  { href: '/admin/monitoring/privacy', label: ADMIN_SECTION_COPY.privacy.title },
  { href: '/admin/monitoring/audit', label: ADMIN_SECTION_COPY.audit.title },
] as const;

const ADMINISTRATION_SECTIONS = [
  { href: '/admin/administration/review', label: ADMIN_SECTION_COPY.review.title },
  { href: '/admin/administration/titles', label: ADMIN_SECTION_COPY.titleEdit.title },
  { href: '/admin/administration/users', label: ADMIN_SECTION_COPY.users.title },
  { href: '/admin/administration/models', label: ADMIN_SECTION_COPY.modelRegistration.title },
  { href: '/admin/administration/jobs', label: ADMIN_SECTION_COPY.jobsAdmin.title },
  { href: '/admin/administration/settings', label: ADMIN_SECTION_COPY.settingsAdmin.title },
] as const;

type Area = 'monitoring' | 'administration';

function areaOf(pathname: string): Area {
  return pathname.startsWith('/admin/administration') ? 'administration' : 'monitoring';
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const area = areaOf(pathname);
  const sections = area === 'monitoring' ? MONITORING_SECTIONS : ADMINISTRATION_SECTIONS;

  return (
    <div className={s.root}>
      <header className={s.topbar}>
        <h1 className={s.title}>لوحة الإدارة</h1>
        <nav className={s.areaSwitch} aria-label="المراقبة أم الإدارة">
          <Link
            href="/admin/monitoring/catalog"
            className={`${s.areaBtn} ${area === 'monitoring' ? s.areaBtnActive : ''}`}
            aria-current={area === 'monitoring' ? 'page' : undefined}
          >
            المراقبة
          </Link>
          <Link
            href="/admin/administration/review"
            className={`${s.areaBtn} ${area === 'administration' ? s.areaBtnActive : ''}`}
            aria-current={area === 'administration' ? 'page' : undefined}
          >
            الإدارة
          </Link>
        </nav>
      </header>

      <div className={s.body}>
        <aside className={s.sidebar} aria-label="أقسام لوحة الإدارة">
          <div className={s.sidebarGroup}>
            <p className={s.sidebarGroupLabel}>المراقبة</p>
            {MONITORING_SECTIONS.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className={`${s.sidebarLink} ${pathname === section.href ? s.sidebarLinkActive : ''}`}
                aria-current={pathname === section.href ? 'page' : undefined}
              >
                {section.label}
              </Link>
            ))}
          </div>
          <div className={s.sidebarGroup}>
            <p className={s.sidebarGroupLabel}>الإدارة</p>
            {ADMINISTRATION_SECTIONS.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className={`${s.sidebarLink} ${pathname === section.href ? s.sidebarLinkActive : ''}`}
                aria-current={pathname === section.href ? 'page' : undefined}
              >
                {section.label}
              </Link>
            ))}
          </div>
        </aside>

        <nav className={s.sectionNav} aria-label={area === 'monitoring' ? 'أقسام المراقبة' : 'أقسام الإدارة'}>
          {sections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className={`${s.sectionLink} ${pathname === section.href ? s.sectionLinkActive : ''}`}
              aria-current={pathname === section.href ? 'page' : undefined}
            >
              {section.label}
            </Link>
          ))}
        </nav>

        <main id="admin-main" className={s.main}>
          {children}
        </main>
      </div>
    </div>
  );
}
