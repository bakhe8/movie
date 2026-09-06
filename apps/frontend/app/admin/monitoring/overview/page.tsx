import { Suspense } from 'react';
import { OverviewMonitor } from '../../../components/admin/monitoring/OverviewMonitor';

export default function OverviewMonitorPage() {
  return (
    <Suspense fallback={null}>
      <OverviewMonitor />
    </Suspense>
  );
}
