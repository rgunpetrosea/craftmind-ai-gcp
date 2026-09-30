import { InventoryTable } from '@/components/dashboard/inventory-table';

export default function InventoryPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-900">Stock & material inventory</h1>
        <p className="text-sm text-stone-500">The Inventory Agent allocates from this shelf, or flags special sourcing with fees and lead time.</p>
      </div>
      <InventoryTable />
    </div>
  );
}
