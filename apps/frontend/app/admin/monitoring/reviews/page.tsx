import { Suspense } from 'react';
import { FeaturesMonitor } from '../../../components/admin/monitoring/FeaturesMonitor';

export default function FeaturesMonitorPage() {
  return (
    <Suspense fallback={null}>
      <FeaturesMonitor />
    </Suspense>
  );
}
