# CraftMind AI (ArtisanOS)

**From messy WhatsApp chats to a quoted, cut-ready bespoke order.**

Bespoke leather workshops run on WhatsApp. A client sends "halo kak", a napkin sketch, a voice note, and "veg-tan coklat ya", and the crafter spends hours turning that into a spec, a price and a cutting plan. CraftMind AI does the drafting, and the crafter keeps the final say.

| Input (WhatsApp) | CraftMind AI output |
| --- | --- |
| Text, voice notes, rough sketches | Structured specification (`OrderPayload`) |
| "Kayak gini tapi warna coklat" | Studio-quality concept mockup, shown next to the original sketch |
| "Ukuran 30x10x22" | 2D pattern pieces, leather **SqFt** with wastage, hardware and labor hours |
| "Veg-tan 1.6mm" | Stock allocated from inventory, or special sourcing with fee and lead time |
| (crafter reviews) | One-click approval sends a formal quotation over WhatsApp |

## Multi-agent pipeline

```
WA inbound ─► Takeover gate ─► Adaptive debounce ─► Orchestrator
                 │                                    │
                 │ FULL_MANUAL / PARTIAL_PAUSE         ├─ Agent 1 Intake     (Gemini Flash, responseSchema, multimodal)
                 └─► log for crafter review            ├─ Agent 4 Pattern/BOM (Gemini Pro) ┐ parallel
                                                      ├─ Agent 2 Visual     (Gemini image / Imagen) ┘
                                                      ├─ Agent 3 Inventory  (stock matcher + sourcing rules)
                                                      └─ Pricing → PENDING_CRAFTER_APPROVAL → Crafter approves → WA quotation
```

- **Gemini proposes, arithmetic decides.** Gemini Pro suggests the pattern pieces. Square footage, stock allocation and price are then recomputed deterministically from those pieces, so every number on the quote can be audited.
- **Offline-safe demo.** Without `GEMINI_API_KEY`, every agent falls back to a deterministic equivalent: a bilingual heuristic parser, template patterns and an SVG concept render. The full flow still works on stage with no network.

## Human-in-the-loop takeover

| Trigger | Result |
| --- | --- |
| Client says `admin`, `crafter`, `manusia` or `pemilik` (also `adminnya`, …) | `FULL_MANUAL`, `escalation_reason: CLIENT_REQUEST`, and a handoff message to the client |
| Crafter replies manually while the AI is on | `PARTIAL_PAUSE` for 30 min (`CRAFTER_OVERRIDE`); the AI resumes automatically afterwards |
| AI makes no progress 3 turns in a row | `FULL_MANUAL`, `CONFUSION_RULE` |
| Dashboard **Take over** / **Pause** / **Resume AI**, or the simulator toggle | Crafter-controlled switch. On resume, the AI answers any unanswered client message |

While the AI is blocked, inbound messages are only logged, flagged `awaiting_crafter_review`, and counted on the dashboard. The orchestrator checks the takeover state again **before sending anything**, so a takeover that happens while Gemini is still working is respected.

**Adaptive debounce.** A client's burst of messages gets one AI reply. The wait adapts to the last message: sketches and short fragments wait longer. A question or closing phrase such as "itu saja kak" or "berapa?" flushes early, and a 15 s cap guarantees a reply.

## Run locally

```bash
npm install
cp .env.example .env.local   # optional: add GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

- `/`: landing page and the **WA Chat Simulator** (AI Co-Pilot / Manual Takeover toggle, send as client or crafter, sketch and voice-note upload)
- `/dashboard`: draft orders board and review screen (side-by-side sketch vs mockup, BOM & SqFt, sourcing, quote approval, conversation with crafter reply)
- `/dashboard/configurator`: category presets (labor rates, wastage, margins, construction defaults)
- `/dashboard/inventory`: leather stock

The in-memory store is seeded with three demo orders: one pending approval, one in manual takeover, one approved.

## API

| Route | Purpose |
| --- | --- |
| `POST /api/webhook/whatsapp` | Inbound WA event `{ phone_number, client_name_wa?, sender?: 'CLIENT'\|'CRAFTER', order_id?, text?, media? }`. Returns `BUFFERED_FOR_AI`, `ESCALATED_TO_CRAFTER`, `LOGGED_FOR_CRAFTER` or `CRAFTER_REPLY_SENT` |
| `GET /api/webhook/whatsapp?phone=` | Session poll (order, messages, `ai_pending`) |
| `DELETE /api/webhook/whatsapp?phone=` | Start a fresh draft for this phone number |
| `POST /api/ai/orchestrator` | Run all agents now `{ order_id, force? }` (`force` recomputes during a takeover without messaging the client) |
| `POST /api/ai/mock-generator` | (Re)render the mockup |
| `POST /api/ai/pattern-bom` | Pattern, SqFt, stock match and quote |
| `GET /api/orders`, `GET /api/orders/:id` | Board and detail (with cost breakdown) |
| `POST /api/orders/:id/takeover` | `{ mode: 'AI_COPILOT'\|'PARTIAL_PAUSE'\|'FULL_MANUAL', pause_minutes? }` |
| `POST /api/orders/:id/approve` | `{ quotation_idr?, note? }` sends the formal quotation |
| `GET/PUT /api/inventory`, `GET/PUT /api/presets` | Master data |

## GCP stack

| Concern | Service |
| --- | --- |
| Hosting | Cloud Run (Next.js 16, Node buildpack) |
| LLM | `@google/genai` against the Gemini API or Vertex AI (`GOOGLE_GENAI_USE_VERTEXAI=true`) |
| State | Firestore (`USE_FIRESTORE=true`): `orders`, `orders/{id}/messages`, `conversations`, `inventory`, `presets` |
| Media | Cloud Storage (`GCS_BUCKET`) |
| Debounce at scale | Cloud Tasks (see `src/lib/utils/debounce.ts`) |

**Model IDs.** The original brief names Gemini 1.5 Flash/Pro and Imagen 3, but Google has retired those IDs. The defaults are therefore `gemini-flash-latest`, `gemini-pro-latest`, `gemini-2.5-flash-image` and `imagen-4.0-generate-001`, and each can be overridden with an env var (see `.env.example`).

### Deploy

```bash
gcloud run deploy craftmind-ai --source . --region asia-southeast1 --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=...,GCP_PROJECT_ID=... \
  --max-instances 1 --no-cpu-throttling
```

`--max-instances 1 --no-cpu-throttling` is needed for the in-memory demo store and debounce timers. With `USE_FIRESTORE=true`, instance count no longer matters for state. Timers still need CPU after the response is sent, or you can move them to Cloud Tasks.

See [WALKTHROUGH.md](WALKTHROUGH.md) for the build plan and the 3-minute demo script.
