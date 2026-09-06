import { Suspense } from 'react';
import { OperationsMonitor } from '../../../components/admin/monitoring/OperationsMonitor';

export default function OperationsMonitorPage() {
  return (
    <Suspense fallback={null}>
      <OperationsMonitor />
    </Suspense>
  );
}
