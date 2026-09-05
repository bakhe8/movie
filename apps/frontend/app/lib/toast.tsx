'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './toast.module.css';

type ToastOptions = { tone?: 'success' | 'error'; action?: { label: string; onClick: () => void } };
type ToastEntry = ToastOptions & { id: number; message: string };
const ToastContext = createContext<{ toast: (message: string, options?: ToastOptions) => void }>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const sequence = useRef(0);
  const toast = useCallback((message: string, options: ToastOptions = {}) => {
    setEntries((current) => [...current.slice(-2), { id: ++sequence.current, message, ...options }]);
  }, []);
  const dismiss = useCallback((id: number) => setEntries((current) => current.filter((item) => item.id !== id)), []);
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className={styles.viewport}>
        {entries.map((entry) => <ToastItem key={entry.id} entry={entry} dismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ entry, dismiss }: { entry: ToastEntry; dismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => dismiss(entry.id), entry.action ? 10000 : 5500);
    return () => window.clearTimeout(timer);
  }, [entry.id, entry.action, dismiss, paused]);
  return (
    <div className={styles.toast} data-tone={entry.tone || 'success'} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span className={styles.icon} aria-hidden="true">{entry.tone === 'error' ? '!' : '✓'}</span>
      <span role={entry.tone === 'error' ? 'alert' : 'status'}>{entry.message}</span>
      {entry.action && <button type="button" onClick={() => { entry.action?.onClick(); dismiss(entry.id); }}>{entry.action.label}</button>}
      <button type="button" aria-label={document.documentElement.lang === 'ar' ? 'إغلاق الإشعار' : 'Dismiss notification'} className={styles.close} onClick={() => dismiss(entry.id)}>×</button>
    </div>
  );
}

export function useToast() { return useContext(ToastContext); }

/** For screens that already own their feedback lifecycle. */
export function Toast({ message, onDismiss, tone = 'success' }: { message: string; onDismiss: () => void; tone?: 'success' | 'error' }) {
  return <div className={styles.viewport}><div className={styles.toast} data-tone={tone}><span className={styles.icon} aria-hidden="true">{tone === 'error' ? '!' : '✓'}</span><span role={tone === 'error' ? 'alert' : 'status'}>{message}</span><button type="button" className={styles.close} aria-label="إغلاق / Dismiss" onClick={onDismiss}>×</button></div></div>;
}
