import { Suspense } from 'react';
import { TitleEditAdmin } from '../../../components/admin/administration/TitleEditAdmin';

export default function TitleEditPage() {
  return (
    <Suspense fallback={null}>
      <TitleEditAdmin />
    </Suspense>
  );
}
