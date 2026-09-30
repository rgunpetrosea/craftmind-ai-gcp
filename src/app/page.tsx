import { ArrowRight, Boxes, Hand, MessageSquareText, Ruler, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { WaChatSimulator } from '@/components/simulation/wa-chat-simulator';

const AGENTS = [
  { icon: MessageSquareText, name: 'Intake Agent', model: 'Gemini Flash', body: 'Chat, voice notes & sketches → structured spec via responseSchema.' },
  { icon: Sparkles, name: 'Visual Agent', model: 'Gemini Image / Imagen', body: 'Rough sketch → studio-quality concept render.' },
  { icon: Ruler, name: 'Pattern Agent', model: 'Gemini Pro', body: '2D component breakdown, SqFt leather & labor estimate.' },
  { icon: Boxes, name: 'Inventory Agent', model: 'Stock matcher', body: 'Allocates shelf stock or flags special sourcing + lead time.' },
];

export default function Home() {
  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 lg:grid-cols-[1fr_auto]">
      <section className="space-y-8">
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-leather-500">ArtisanOS · AI Builder Cup 2026</p>
          <h1 className="text-4xl font-bold leading-tight text-stone-900 sm:text-5xl">
            From messy WhatsApp chats to a quoted, cut-ready order.
          </h1>
          <p className="max-w-xl text-lg text-stone-600">
            CraftMind AI reads client texts, voice notes and napkin sketches, then drafts the spec, a studio mockup, the pattern
            breakdown with leather square footage, stock allocation and a quote — for the crafter to approve in one click.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg bg-leather-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-leather-800"
          >
            Open crafter dashboard <ArrowRight className="h-4 w-4" />
          </Link>
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
            <Hand className="h-4 w-4" /> Human-in-the-loop takeover
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-leather-900">
            <li>
              • Client types <b>admin</b>, <b>crafter</b>, <b>manusia</b> or <b>pemilik</b> → AI switches to <code>FULL_MANUAL</code>.
            </li>
            <li>
              • Crafter replies manually → AI enters <code>PARTIAL_PAUSE</code> for 30 minutes, then resumes.
            </li>
            <li>• AI stalls 3 turns in a row → confusion rule escalates to the crafter.</li>
            <li>• While paused, every inbound message is logged and flagged for crafter review.</li>
          </ul>
          <p className="mt-3 text-xs text-leather-700">Try it: use the toggle in the simulator, or send “Mau bicara dengan admin”.</p>
        </div>
      </section>

      <section className="flex justify-center lg:sticky lg:top-20 lg:self-start">
        <WaChatSimulator />
      </section>
    </div>
  );
}
