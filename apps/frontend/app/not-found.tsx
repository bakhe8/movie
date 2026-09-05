import Link from 'next/link';
import { BrandMark } from './components/BrandMark';
import styles from './not-found.module.css';

// A missing page used to be Next's default: an English sentence, laid out
// left-to-right inside a right-to-left document, with no way back
// (UX_AUDIT_MOBILE_2026-09-05 P2 #17). This one is the product's own -- Arabic
// first, the English line under it since a link can be shared with anyone, and
// one way home.
//
// It renders inside the root layout, so it already has the fonts, the tokens
// and both themes; `notFound()` from the development-only preview routes lands
// here too.
export default function NotFound() {
  return (
    <main className={styles.page}>
      <span className={styles.mark}>
        <BrandMark size={28} />
      </span>
      <h1 className={styles.title}>الصفحة غير موجودة</h1>
      <p className={styles.body}>الرابط قديم أو فيه خطأ. لم يضع شيء من حسابك.</p>
      <p className={styles.bodyEn} dir="ltr" lang="en">
        This page does not exist. Nothing in your account is affected.
      </p>
      <Link href="/" className={styles.home}>
        إلى Kolme
      </Link>
    </main>
  );
}
