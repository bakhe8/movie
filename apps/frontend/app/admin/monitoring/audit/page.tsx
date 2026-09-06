import { Suspense } from 'react';
import { AuditLogMonitor } from '../../../components/admin/monitoring/AuditLogMonitor';

export default function AuditLogMonitorPage() {
  return (
    <Suspense fallback={null}>
      <AuditLogMonitor />
    </Suspense>
  );
}
