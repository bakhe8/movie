import { Suspense } from 'react';
import { FeatureReviewAdmin } from '../../../components/admin/administration/FeatureReviewAdmin';

export default function FeatureReviewPage() {
  return (
    <Suspense fallback={null}>
      <FeatureReviewAdmin />
    </Suspense>
  );
}
