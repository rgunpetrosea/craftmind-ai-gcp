import { OrdersBoard } from '@/components/dashboard/orders-board';
import { getStore } from '@/lib/gcp/firestore';
import { familiesOf } from '@/lib/workspaces';

export default async function DashboardPage({ params }: PageProps<'/[workspace_id]/dashboard'>) {
  const { workspace_id } = await params;
  const profile = await getStore().getCrafterProfile(workspace_id);
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-leather-500">
          {profile.workshop_name} · {familiesOf(profile).join(' + ')}
        </p>
        <h1 className="text-2xl font-bold text-stone-900">Draft orders</h1>
        <p className="text-sm text-stone-500">Review AI drafts side by side, approve mockups before the client sees them, take over conversations, and approve quotations.</p>
      </div>
      <OrdersBoard />
    </div>
  );
}
