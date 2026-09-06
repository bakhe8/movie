import { Suspense } from 'react';
import { JobsMonitor } from '../../../components/admin/monitoring/JobsMonitor';

export default function JobsMonitorPage() {
  return (
    <Suspense fallback={null}>
      <JobsMonitor />
    </Suspense>
  );
}
