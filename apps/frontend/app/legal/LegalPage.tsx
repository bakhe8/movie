import Link from 'next/link';
import { BrandMark } from '../components/BrandMark';
import { formatDate } from '../lib/format';
import { LEGAL, type Lang, type LegalKind } from './content';
import { DocumentLanguage } from './DocumentLanguage';
import styles from './legal.module.css';

/**
 * The reading page for the Terms and the Privacy Notice (blueprint gap 7,
 * docs/CONSENT_COPY_2026-09-04.md §3). A server component: no session, no
 * client state; the language comes from `?lang=` because the app keeps its
 * UI language in client state and links here with it. Arabic by default,
 * like the document root.
 */
const chrome = {
  ar: { brand: 'Kolme', toApp: 'إلى التطبيق', other: 'اللغة: English', updated: 'آخر تحديث', terms: 'شروط الاستخدام', privacy: 'إشعار الخصوصية', dataNotice: 'إشعار البيانات والمصادر' },
  en: { brand: 'Kolme', toApp: 'To the app', other: 'اللغة: العربية', updated: 'Last updated', terms: 'Terms of Use', privacy: 'Privacy Notice', dataNotice: 'Data notice' },
};

export function resolveLang(value: string | string[] | undefined): Lang {
  return value === 'en' ? 'en' : 'ar';
}

export function LegalPage({ kind, lang }: { kind: LegalKind; lang: Lang }) {
  const doc = LEGAL[kind][lang];
  const c = chrome[lang];
  const otherLang: Lang = lang === 'ar' ? 'en' : 'ar';
  const otherKind: LegalKind = kind === 'terms' ? 'privacy' : 'terms';

  return (
    <main className={styles.page} lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <DocumentLanguage lang={lang} />
      <header className={styles.top}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark}>
            <BrandMark />
          </span>
          {c.brand}
        </Link>
        <nav className={styles.topLinks} aria-label={c.brand}>
          <Link href={`/${kind}?lang=${otherLang}`} className={styles.link} lang={otherLang}>
            {c.other}
          </Link>
          <Link href="/" className={styles.link}>
            {c.toApp}
          </Link>
        </nav>
      </header>

      <article className={styles.article}>
        <p className={styles.eyebrow}>
          {c.updated} <time dateTime={doc.updated}>{formatDate(doc.updated, lang)}</time>
        </p>
        <h1>{doc.title}</h1>
        <p className={styles.draft} role="note">
          {doc.draftNotice}
        </p>
        <p className={styles.intro}>{doc.intro}</p>

        {doc.sections.map((section) => (
          <section key={section.head} className={styles.section}>
            <h2>{section.head}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.items && (
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <footer className={styles.foot}>
          <Link href={`/${otherKind}?lang=${lang}`} className={styles.link}>
            {c[otherKind]}
          </Link>
          <Link href={`/data-notice?lang=${lang}`} className={styles.link}>
            {c.dataNotice}
          </Link>
        </footer>
      </article>
    </main>
  );
}
