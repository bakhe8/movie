import { TitleDetailMonitor } from '../../../../components/admin/monitoring/TitleDetailMonitor';

export default async function TitleDetailPage({ params }: { params: Promise<{ titleId: string }> }) {
  const { titleId } = await params;
  return <TitleDetailMonitor titleId={titleId} />;
}
