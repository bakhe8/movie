import { Suspense } from 'react';
import { UserManagementAdmin } from '../../../components/admin/administration/UserManagementAdmin';

export default function UserManagementPage() {
  return (
    <Suspense fallback={null}>
      <UserManagementAdmin />
    </Suspense>
  );
}
