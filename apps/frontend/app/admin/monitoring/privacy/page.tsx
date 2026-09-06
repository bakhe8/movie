import { Suspense } from 'react';
import { PrivacyMonitor } from '../../../components/admin/monitoring/PrivacyMonitor';

export default function PrivacyMonitorPage() {
  return (
    <Suspense fallback={null}>
      <PrivacyMonitor />
    </Suspense>
  );
}
