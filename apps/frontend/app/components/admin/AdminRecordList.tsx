import s from './AdminRecordList.module.css';

export interface AdminRecordListColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  mono?: boolean;
}

export interface AdminRecordListProps<T> {
  columns: AdminRecordListColumn<T>[];
  rows: T[] | null;
  keyOf: (row: T) => string;
  loading: boolean;
  failed: boolean;
  failedLabel: string;
  onRetry?: () => void;
  emptyLabel: string;
  stale?: boolean;
  staleLabel?: string;
  // The phone card for one row -- 3-5 fields, per plan §12.1, chosen by the
  // caller from the same row object the table columns read.
  renderCard: (row: T) => React.ReactNode;
}

// ADMIN-W2 (plan §12.4): the shared list primitive behind Catalog, Features
// and Privacy monitoring -- one data source and one set of states (loading,
// stale, failed, empty) rendered as cards on the phone and a table from
// tablet up, never a horizontal-scrolling table as the phone experience.
export function AdminRecordList<T>({
  columns,
  rows,
  keyOf,
  loading,
  failed,
  failedLabel,
  onRetry,
  emptyLabel,
  stale,
  staleLabel,
  renderCard,
}: AdminRecordListProps<T>) {
  return (
    <div>
      {loading && !rows && <p className={s.status}>جارٍ التحميل…</p>}
      {stale && rows && <p className={s.status} role="status" aria-live="polite">{staleLabel ?? 'جارٍ التحديث…'}</p>}
      {failed && (
        <p className={`${s.status} ${s.statusError}`} role="status" aria-live="polite">
          {failedLabel}
          {onRetry && (
            <button type="button" className={s.retryBtn} onClick={onRetry}>
              إعادة المحاولة
            </button>
          )}
        </p>
      )}

      {rows && rows.length === 0 && !loading && <p className={s.empty}>{emptyLabel}</p>}

      {rows && rows.length > 0 && (
        <>
          <ul className={s.cardList}>
            {rows.map((row) => (
              <li key={keyOf(row)} className={s.card}>
                {renderCard(row)}
              </li>
            ))}
          </ul>

          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col.key}>{col.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={keyOf(row)}>
                    {columns.map((col) => (
                      <td key={col.key} className={col.mono ? s.mono : undefined}>
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
