import { redirect } from 'next/navigation';

// ADMIN-W2/W3: the old /admin entry stays reachable (compatibility, W0
// preservation A1/A2) by navigating straight into the new IA's default
// destination -- a redirect only, never a write on load. AdminScreen.tsx is
// kept, unrendered, until the full preservation matrix and this wrapper are
// both accepted (plan §22). Lands on "نظرة عامة" now that W3 built it --
// the natural first screen, per plan §11's IA ordering.
export default function AdminPage() {
  redirect('/admin/monitoring/overview');
}
