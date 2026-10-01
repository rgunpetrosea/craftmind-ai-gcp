'use client';

import { Bot, CheckCheck, Circle, CircleCheck, Hand, ImagePlus, ListChecks, Loader2, Mic, PauseCircle, RotateCcw, Send, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { ESCALATION_LABEL } from '@/components/ui/status-badges';
import { postJson, usePoll } from '@/lib/hooks/use-poll';
import { getConstruction, normalizeSpecifications, requiredTopics, TOPICS, type TopicId } from '@/lib/spec/catalog';
import type { ChatMessage, Conversation, InboundWhatsAppEvent, OrderPayload } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { WaText } from './wa-text';

interface SessionResponse {
  conversation: Conversation | null;
  order: OrderPayload | null;
  messages: ChatMessage[];
  ai_pending: boolean;
}

const QUICK_MESSAGES = [
  'Halo kak, mau bikin dompet kartu pipih',
  'Muat 4 kartu + selipan uang di tengah, Epsom hitam',
  'Ukuran 10x7 cm, emboss inisial R.W di pojok kanan bawah',
  'Terserah mas untuk lainnya. Itu saja kak',
  'Mau bicara dengan admin/crafter',
];

interface Scenario {
  id: string;
  category: string;
  model: string;
  needs_attachment: boolean;
  client_turns: string[];
  followup_turns: string[];
  post_quote_turns: string[];
  expected_summary: string;
}

const scenarioTurns = (sc: Scenario) => [...sc.client_turns, ...sc.followup_turns, ...sc.post_quote_turns];

const TOPIC_LABEL: Record<TopicId, string> = {
  construction: 'Model',
  dimensions: 'Ukuran',
  leather: 'Kulit',
  card_layout: 'Slot kartu',
  customization: 'Emboss',
  thread: 'Benang',
  lining: 'Lining',
  edge: 'Pinggiran',
  zipper: 'Sleting',
  strap: 'Strap',
  hardware: 'Hardware',
};

/** Requirement-gathering progress: required topics plus the optional details this form factor asks about. */
function SpecChecklist({ order }: { order: OrderPayload }) {
  const spec = normalizeSpecifications(order.specifications);
  const topics = [...new Set<TopicId>([...requiredTopics(spec), ...getConstruction(spec.construction_type).detail_topics])];
  const asked = new Set(order.intake?.asked_topics ?? []);
  return (
    <div className="flex flex-wrap items-center gap-1 bg-white/70 px-3 py-1.5 text-[10px] text-stone-600">
      <ListChecks className="h-3 w-3 text-wa-header" />
      {topics.map((t) => {
        const done = TOPICS[t].isFilled(spec);
        return (
          <span
            key={t}
            title={TOPICS[t].required ? 'required' : 'optional detail'}
            className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5', done ? 'bg-emerald-100 text-emerald-800' : asked.has(t) ? 'bg-amber-100 text-amber-900' : 'bg-stone-100')}
          >
            {done ? <CircleCheck className="h-2.5 w-2.5" /> : <Circle className="h-2.5 w-2.5" />}
            {TOPIC_LABEL[t]}
            {TOPICS[t].required && '*'}
          </span>
        );
      })}
      {order.session_state === 'PENDING_CRAFTER_APPROVAL' && <span className="ml-auto font-semibold text-emerald-700">Spec card terkunci ✓</span>}
    </div>
  );
}

const MAX_IMAGE_PX = 1024;

/** Downscale sketches client-side so payloads stay small (and under Firestore limits without GCS). */
async function imageToDataUrl(file: File): Promise<{ url: string; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { url: canvas.toDataURL('image/jpeg', 0.85), mime: 'image/jpeg' };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function WaChatSimulator({ defaultPhone = '+6281299990001', defaultName = 'Sari' }: { defaultPhone?: string; defaultName?: string }) {
  const [phone, setPhone] = useState(defaultPhone);
  const [name, setName] = useState(defaultName);
  const [draft, setDraft] = useState('');
  const [sendAs, setSendAs] = useState<'CLIENT' | 'CRAFTER'>('CLIENT');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [step, setStep] = useState(0);
  const { data: scenarioData } = usePoll<{ scenarios: Scenario[] }>('/api/scenarios', 60 * 60 * 1000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const { data, refresh } = usePoll<SessionResponse>(`/api/webhook/whatsapp?phone=${encodeURIComponent(phone)}`, 1500);
  const order = data?.order ?? null;
  const messages = data?.messages ?? [];
  const aiOn = !order || order.automation_mode === 'AI_COPILOT';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, data?.ai_pending]);

  async function send(event: Omit<InboundWhatsAppEvent, 'phone_number' | 'client_name_wa' | 'sender'>) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await postJson<{ action: string; keyword?: string; debounce_ms?: number }>('/api/webhook/whatsapp', {
        phone_number: phone,
        client_name_wa: name,
        sender: sendAs,
        ...event,
      });
      setNotice(
        {
          BUFFERED_FOR_AI: `Buffered — AI replies in ~${Math.round((res.debounce_ms ?? 0) / 100) / 10}s unless more messages arrive`,
          ESCALATED_TO_CRAFTER: `Keyword "${res.keyword}" detected → switched to FULL_MANUAL`,
          LOGGED_FOR_CRAFTER: 'AI paused — message logged for crafter review',
          CRAFTER_REPLY_SENT: 'Crafter reply sent — AI auto-paused (partial takeover)',
        }[res.action] ?? res.action,
      );
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendText(text: string) {
    if (!text.trim()) return;
    setDraft('');
    await send({ text });
  }

  async function startScenario(id: string) {
    const sc = scenarioData?.scenarios.find((x) => x.id === id) ?? null;
    setScenario(sc);
    setStep(0);
    if (!sc) return;
    await fetch(`/api/webhook/whatsapp?phone=${encodeURIComponent(phone)}`, { method: 'DELETE' });
    setNotice(`${sc.id}: ${sc.model}. Kirim pesan klien satu per satu, tunggu balasan AI di antaranya.${sc.needs_attachment ? ' Skenario asli juga mengirim foto/sketsa; lampirkan lewat ikon gambar.' : ''}`);
    await refresh();
  }

  async function sendScenarioStep() {
    if (!scenario) return;
    const turn = scenarioTurns(scenario)[step];
    if (!turn) return;
    setStep(step + 1);
    await sendText(turn);
  }

  async function onFile(file: File | undefined, type: 'image' | 'audio') {
    if (!file) return;
    if (type === 'image') {
      const { url, mime } = await imageToDataUrl(file);
      await send({ text: draft.trim() || undefined, media: { type, url, mime_type: mime } });
    } else {
      if (file.size > 5 * 1024 * 1024) return setNotice('Voice note must be under 5 MB');
      await send({ text: draft.trim() || undefined, media: { type, url: await fileToDataUrl(file), mime_type: file.type || 'audio/mpeg' } });
    }
    setDraft('');
  }

  async function toggleAi(next: boolean) {
    if (!order) return;
    setBusy(true);
    try {
      await postJson(`/api/orders/${order.order_id}/takeover`, { mode: next ? 'AI_COPILOT' : 'FULL_MANUAL' });
      setNotice(next ? 'Handed back to AI Co-Pilot' : 'Manual takeover — AI will stay silent');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function resetChat() {
    setScenario(null);
    setStep(0);
    await fetch(`/api/webhook/whatsapp?phone=${encodeURIComponent(phone)}`, { method: 'DELETE' });
    setNotice('Started a new draft order');
    await refresh();
  }

  return (
    <div className="flex h-[680px] w-full max-w-md flex-col overflow-hidden rounded-[28px] border-8 border-stone-900 bg-wa-wallpaper shadow-2xl">
      {/* Header */}
      <div className="bg-wa-header px-4 py-3 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-leather-400 text-sm font-bold">CM</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">CraftMind Leather Studio</p>
            <p className="text-[11px] text-emerald-100">{data?.ai_pending ? 'mengetik…' : 'online'}</p>
          </div>
          <button onClick={resetChat} title="New chat" className="rounded-full p-1.5 hover:bg-white/10">
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-lg bg-black/15 px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            {aiOn ? <Bot className="h-4 w-4" /> : <Hand className="h-4 w-4" />}
            <span className="font-medium">{aiOn ? 'AI Co-Pilot' : 'Manual Takeover'}</span>
          </div>
          <Switch checked={aiOn} onChange={toggleAi} disabled={busy || !order} label="AI Co-Pilot" />
        </div>
      </div>

      {/* Takeover status strip */}
      {order && order.automation_mode !== 'AI_COPILOT' && (
        <div
          className={cn(
            'flex items-center gap-2 px-4 py-1.5 text-[11px] font-medium',
            order.automation_mode === 'FULL_MANUAL' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900',
          )}
        >
          {order.automation_mode === 'FULL_MANUAL' ? <Hand className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
          {order.automation_mode === 'FULL_MANUAL'
            ? `AI off · ${order.escalation_reason ? ESCALATION_LABEL[order.escalation_reason] : 'manual'}`
            : `AI paused until ${order.paused_until ? time(order.paused_until) : '—'} · crafter replied`}
        </div>
      )}

      {order && order.session_state !== 'IDLE' && order.session_state !== 'APPROVED' && <SpecChecklist order={order} />}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <p className="mx-auto w-fit rounded-md bg-amber-50 px-3 py-1.5 text-center text-[11px] text-stone-600 shadow-sm">
            Kirim pesan sebagai klien untuk memulai simulasi 👇
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        {data?.ai_pending && (
          <div className="flex w-fit items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs text-stone-500 shadow-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> AI agents working…
          </div>
        )}
      </div>

      {/* Scenario player / quick replies */}
      <div className="space-y-1.5 bg-wa-wallpaper px-3 pb-2">
        <select
          value={scenario?.id ?? ''}
          onChange={(e) => startScenario(e.target.value)}
          className="w-full rounded-md bg-white px-2 py-1 text-[11px] text-stone-700 ring-1 ring-stone-300"
          aria-label="Test scenario"
        >
          <option value="">Free chat — or pick a test scenario from scenarios.csv…</option>
          {scenarioData?.scenarios.map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.id} · {sc.category} · {sc.model}
            </option>
          ))}
        </select>
        {scenario ? (
          (() => {
            const turns = scenarioTurns(scenario);
            const next = turns[step];
            return next ? (
              <button
                disabled={busy || !!data?.ai_pending}
                onClick={sendScenarioStep}
                className="w-full rounded-lg bg-white px-3 py-1.5 text-left text-[11px] text-wa-header shadow-sm ring-1 ring-emerald-300 hover:bg-emerald-50 disabled:opacity-50"
              >
                <span className="font-semibold">
                  Kirim pesan {step + 1}/{turns.length}
                  {step >= scenario.client_turns.length && step < scenario.client_turns.length + scenario.followup_turns.length ? ' (jawaban lanjutan)' : ''}
                  {step >= scenario.client_turns.length + scenario.followup_turns.length ? ' (revisi setelah spec card)' : ''}:
                </span>{' '}
                {next}
              </button>
            ) : (
              <p className="rounded-lg bg-white/80 px-3 py-1.5 text-[11px] text-stone-600">
                Skenario selesai. Harapan: <span className="font-medium">{scenario.expected_summary}</span>
              </p>
            );
          })()
        ) : (
          <div className="flex gap-1.5 overflow-x-auto">
            {QUICK_MESSAGES.map((q) => (
              <button
                key={q}
                disabled={busy}
                onClick={() => sendText(q)}
                className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] text-wa-header shadow-sm ring-1 ring-emerald-200 hover:bg-emerald-50 disabled:opacity-50"
              >
                {q.length > 34 ? `${q.slice(0, 32)}…` : q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="space-y-2 bg-stone-100 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-stone-600">
          <span>Send as</span>
          {(['CLIENT', 'CRAFTER'] as const).map((who) => (
            <button
              key={who}
              onClick={() => setSendAs(who)}
              className={cn('rounded-full px-2 py-0.5 ring-1', sendAs === who ? 'bg-wa-header text-white ring-wa-header' : 'bg-white ring-stone-300')}
            >
              {who === 'CLIENT' ? 'Client' : 'Crafter (manual)'}
            </button>
          ))}
          <input value={name} onChange={(e) => setName(e.target.value)} className="ml-auto w-16 rounded bg-white px-1.5 py-0.5 ring-1 ring-stone-300" aria-label="Client name" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-28 rounded bg-white px-1.5 py-0.5 ring-1 ring-stone-300" aria-label="Client phone" />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendText(draft);
          }}
          className="flex items-center gap-2"
        >
          <button type="button" onClick={() => imageInput.current?.click()} title="Send sketch" className="text-stone-500 hover:text-wa-header">
            <ImagePlus className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => audioInput.current?.click()} title="Send voice note (audio file)" className="text-stone-500 hover:text-wa-header">
            <Mic className="h-5 w-5" />
          </button>
          <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0], 'image').finally(() => (e.target.value = ''))} />
          <input ref={audioInput} type="file" accept="audio/*" hidden onChange={(e) => onFile(e.target.files?.[0], 'audio').finally(() => (e.target.value = ''))} />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={sendAs === 'CLIENT' ? 'Ketik pesan' : 'Balas sebagai crafter'}
            className="h-10 flex-1 rounded-full bg-white px-4 text-sm outline-none ring-1 ring-stone-200 focus:ring-wa-accent"
          />
          <button type="submit" disabled={busy || !draft.trim()} className="flex h-10 w-10 items-center justify-center rounded-full bg-wa-header text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
        {notice && <p className="text-[11px] text-stone-600">{notice}</p>}
      </div>
    </div>
  );
}

function Bubble({ message: m }: { message: ChatMessage }) {
  if (m.sender === 'SYSTEM') {
    return (
      <div className="mx-auto max-w-[85%] rounded-lg bg-amber-50 px-3 py-1.5 text-center text-[11px] text-amber-900 shadow-sm">
        <WaText text={m.text ?? ''} />
      </div>
    );
  }
  const mine = m.sender === 'CLIENT';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[82%] rounded-lg px-2.5 py-1.5 text-[13px] leading-snug shadow-sm', mine ? 'bg-wa-bubble' : 'bg-white')}>
        {!mine && (
          <p className={cn('mb-0.5 flex items-center gap-1 text-[10px] font-semibold', m.sender === 'AI' ? 'text-emerald-700' : 'text-leather-600')}>
            {m.sender === 'AI' ? <Bot className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
            {m.sender === 'AI' ? 'AI Co-Pilot' : 'Crafter'}
          </p>
        )}
        {m.media_type === 'image' && m.media_url && (
          // eslint-disable-next-line @next/next/no-img-element -- data URLs / GCS objects
          <img src={m.media_url} alt="attachment" className="mb-1 max-h-48 rounded-md object-contain" />
        )}
        {m.media_type === 'audio' && m.media_url && <audio controls src={m.media_url} className="mb-1 h-8 w-56" />}
        {m.text && <WaText text={m.text} />}
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-stone-400">
          {m.awaiting_crafter_review && <span className="text-amber-700">awaiting crafter ·</span>}
          {time(m.created_at)}
          {mine && <CheckCheck className="h-3 w-3 text-sky-500" />}
        </p>
      </div>
    </div>
  );
}
