'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import s from './AdminShell.module.css';

// ADMIN-W2 (ADR-117 "Decision — separation"): the target IA (plan §11) split
// into two areas. Monitoring is read-only; only Administration ever imports
// a mutation client. W2 ships every section that already exists today --
// later packages (W3-W6) add the remaining monitoring/administration rows
// without moving these.
const MONITORING_SECTIONS = [
  { href: '/admin/monitoring/catalog', label: 'الكتالوج' },
  { href: '/admin/monitoring/reviews', label: 'السمات والمراجعات' },
  { href: '/admin/monitoring/models', label: 'النماذج والتعلّم' },
  { href: '/admin/monitoring/privacy', label: 'الخصوصية' },
] as const;

const ADMINISTRATION_SECTIONS = [
  { href: '/admin/administration/review', label: 'مراجعة المحتوى' },
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
