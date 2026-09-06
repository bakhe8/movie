import { Suspense } from 'react';
import { CatalogMonitor } from '../../../components/admin/monitoring/CatalogMonitor';

export default function CatalogMonitorPage() {
  return (
    <Suspense fallback={null}>
      <CatalogMonitor />
    </Suspense>
  );
}
