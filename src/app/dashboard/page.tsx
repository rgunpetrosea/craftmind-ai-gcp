import { OrdersBoard } from '@/components/dashboard/orders-board';

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-900">Draft orders</h1>
        <p className="text-sm text-stone-500">Review AI drafts side by side, take over conversations, and approve quotations.</p>
      </div>
      <OrdersBoard />
    </div>
  );
}
