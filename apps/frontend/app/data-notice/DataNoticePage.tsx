import Link from 'next/link';
import { BrandMark } from '../components/BrandMark';
import { formatDate } from '../lib/format';
import type { Lang } from '../legal/content';
import { DocumentLanguage } from '../legal/DocumentLanguage';
import legal from '../legal/legal.module.css';
import { NOTICE } from './content';
import styles from './DataNoticePage.module.css';

/**
 * The reading page for the development notice and third-party data statement
 * (owner decision 2026-09-04, docs/DATA_NOTICE_COPY_2026-09-04.md). Same
 * shape as the Terms / Privacy reading page and the same styles, plus one
 * sources table; a server component, language from `?lang=`, Arabic by
 * default. Linked from every attribution line through <DataNoticeBadge />.
 */
const chrome = {
  ar: { brand: 'Kolme', toApp: 'إلى التطبيق', other: 'اللغة: English', updated: 'آخر تحديث', terms: 'شروط الاستخدام', privacy: 'إشعار الخصوصية', scrollColumns: 'اسحب أفقيًا لرؤية بقية الأعمدة' },
  en: { brand: 'Kolme', toApp: 'To the app', other: 'اللغة: العربية', updated: 'Last updated', terms: 'Terms of Use', privacy: 'Privacy Notice', scrollColumns: 'Swipe sideways to see more columns' },
};

export function DataNoticePage({ lang }: { lang: Lang }) {
  const doc = NOTICE[lang];
  const c = chrome[lang];
  const otherLang: Lang = lang === 'ar' ? 'en' : 'ar';

  return (
    <main className={legal.page} lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <DocumentLanguage lang={lang} />
      <header className={legal.top}>
        <Link href="/" className={legal.brand}>
          <span className={legal.mark}>
            <BrandMark />
          </span>
          {c.brand}
        </Link>
        <nav className={legal.topLinks} aria-label={c.brand}>
          <Link href={`/data-notice?lang=${otherLang}`} className={legal.link} lang={otherLang}>
            {c.other}
          </Link>
          <Link href="/" className={legal.link}>
            {c.toApp}
          </Link>
        </nav>
      </header>

      <article className={legal.article}>
        <p className={legal.eyebrow}>
          {c.updated} <time dateTime={doc.updated}>{formatDate(doc.updated, lang)}</time>
        </p>
        <h1>{doc.title}</h1>
        <p className={legal.draft} role="note">
          {doc.draftNotice}
        </p>
        <p className={legal.intro}>{doc.intro}</p>

        {doc.sections.map((section) => (
          <section key={section.head} className={legal.section}>
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

        <section className={legal.section}>
          <h2 id="sources-heading">{doc.sourcesHead}</h2>
          <p>{doc.sourcesIntro}</p>
          <div className={styles.tableFrame}>
            <div className={styles.scrollHint}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" />
              </svg>
              <span>{c.scrollColumns}</span>
            </div>
            <div className={styles.tableWrap} role="region" aria-labelledby="sources-heading" tabIndex={0}>
            <table className={styles.sources}>
              <thead>
                <tr>
                  <th scope="col">{doc.sourcesColumns.name}</th>
                  <th scope="col">{doc.sourcesColumns.what}</th>
                  <th scope="col">{doc.sourcesColumns.terms}</th>
                  <th scope="col">{doc.sourcesColumns.attribution}</th>
                </tr>
              </thead>
              <tbody>
                {doc.sources.map((source) => (
                  <tr key={source.name}>
                    <th scope="row">{source.name}</th>
                    <td>{source.what}</td>
                    <td>{source.terms}</td>
                    {/* Attribution lines are quoted in the source's own language and direction. */}
                    <td lang="en" dir="ltr" className={styles.attribution}>
                      {source.attribution}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </section>

        <section className={legal.section}>
          <h2>{doc.contactHead}</h2>
          {doc.contactParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>

        <footer className={legal.foot}>
          <Link href={`/terms?lang=${lang}`} className={legal.link}>
            {c.terms}
          </Link>
          <Link href={`/privacy?lang=${lang}`} className={legal.link}>
            {c.privacy}
          </Link>
        </footer>
      </article>
    </main>
  );
}
