import styles from './LoadingScene.module.css';

export function LoadingScene({ lang }: { lang: 'ar' | 'en' }) {
  return <div className={styles.scene} role="status" aria-label={lang === 'ar' ? 'جارٍ تجهيز المشهد' : 'Setting the scene'}><div className={styles.frames} aria-hidden="true"><i /><i /><i /></div><span>Kolme</span></div>;
}
