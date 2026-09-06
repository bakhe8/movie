import { AdminShellRoot } from '../components/admin/AdminShellRoot';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShellRoot>{children}</AdminShellRoot>;
}
