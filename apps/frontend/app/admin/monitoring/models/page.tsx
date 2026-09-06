import { Suspense } from 'react';
import { ModelsMonitor } from '../../../components/admin/monitoring/ModelsMonitor';

export default function ModelsMonitorPage() {
  return (
    <Suspense fallback={null}>
      <ModelsMonitor />
    </Suspense>
  );
}
