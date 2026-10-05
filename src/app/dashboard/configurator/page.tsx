import { PresetEditor } from '@/components/dashboard/preset-editor';
import { ProfileEditor } from '@/components/dashboard/profile-editor';

export default function ConfiguratorPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 py-8">
      <section>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-stone-900">Workshop profile</h1>
          <p className="text-sm text-stone-500">
            Brands the assistant&apos;s first message and sets its domain boundary: requests outside the allowed categories are politely declined.
          </p>
        </div>
        <ProfileEditor />
      </section>
      <section>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-stone-900">Category master presets</h2>
          <p className="text-sm text-stone-500">
            Labor rates, wastage, margins and construction defaults the agents use when the client leaves a detail unspecified.
          </p>
        </div>
        <PresetEditor />
      </section>
    </div>
  );
}
