import { PresetEditor } from '@/components/dashboard/preset-editor';

export default function ConfiguratorPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-900">Category master presets</h1>
        <p className="text-sm text-stone-500">
          Labor rates, wastage, margins and construction defaults the agents use when the client leaves a detail unspecified.
        </p>
      </div>
      <PresetEditor />
    </div>
  );
}
