import { ArrowRight, Boxes, Hand, MessageSquareText, ScanEye, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { WaChatSimulator } from '@/components/simulation/wa-chat-simulator';

const AGENTS = [
  {
    icon: MessageSquareText,
    name: 'Intake Agent',
    model: 'Gemini Flash',
    body: 'Multi-turn Indonesian intake, structured specification extraction & guided design direction probing.',
  },
  {
    icon: Sparkles,
    name: 'Visual Agent',
    model: 'Gemini 2.5 Flash Image / Imagen',
    body: 'Studio-quality concept renders based on abstract design directions and client taste references.',
  },
  {
    icon: ScanEye,
    name: 'Design Intelligence & Critic',
    model: 'Gemini Pro',
    body: '10-point design evaluation loop, automated revision refining, and Crafter approval staging.',
  },
  {
    icon: Boxes,
    name: 'Inventory & Pattern Agent',
    model: 'Stock matcher · BoM',
    body: 'Scoped material stock allocation (Leather vs Furniture) and SqFt / BoM labor estimations.',
  },
];

export default function Home() {
  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 lg:grid-cols-[1fr_auto]">
      <section className="space-y-8">
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-leather-500">CraftMind AI · AI Builder Cup 2026</p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-stone-900 sm:text-5xl">
            From messy WhatsApp chats to a quoted, cut-ready bespoke order.
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-stone-600">
            CraftMind AI converts client texts, voice notes, and sketches into structured specs, multi-angle studio mockups, BoM material
            breakdowns, and formal quotes — with full Crafter approval control.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg bg-leather-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-leather-800"
            >
              Open crafter dashboard <ArrowRight className="h-4 w-4" />
            </Link>
            <span className="self-center text-xs text-stone-500">Demo workspaces: Leather Studio · Wood Studio</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {AGENTS.map(({ icon: Icon, name, model, body }) => (
            <div key={name} className="rounded-xl bg-white p-4 ring-1 ring-stone-200">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-leather-600" />
                <p className="text-sm font-semibold text-stone-900">{name}</p>
                <span className="ml-auto rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600">{model}</span>
              </div>
              <p className="mt-2 text-sm text-stone-600">{body}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-leather-50 p-5 ring-1 ring-leather-200">
          <p className="flex items-center gap-2 text-sm font-semibold text-leather-800">
            <Hand className="h-4 w-4" /> Human-in-the-Loop Takeover
          </p>
          <p className="mt-1 text-sm text-leather-900">Seamless transfer to crafter manual control upon request or rule trigger.</p>
          <ul className="mt-2 space-y-1.5 text-sm text-leather-900">
            <li>
              • Client types <b>admin</b>, <b>crafter</b>, <b>manusia</b> or <b>pemilik</b> → AI switches to <code>FULL_MANUAL</code>.
            </li>
            <li>• Crafter replies manually → AI enters <code>PARTIAL_PAUSE</code> for 30 minutes, then resumes.</li>
            <li>• Every AI mockup waits for the crafter&apos;s &ldquo;Approve &amp; Send to Client&rdquo; before the client sees it.</li>
            <li>• AI stalls 3 turns in a row → confusion rule escalates to the crafter.</li>
          </ul>
          <p className="mt-3 text-xs text-leather-700">
            Try it: switch between Leather Studio and Wood Studio above the chat, or send &ldquo;Mau bicara dengan admin&rdquo;.
          </p>
        </div>
      </section>

      <section className="flex justify-center lg:sticky lg:top-20 lg:self-start">
        <WaChatSimulator />
      </section>
    </div>
  );
}
