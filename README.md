# CraftMind AI (ArtisanOS)

**From messy WhatsApp chats to an original, crafter-approved bespoke design and quote.**

Bespoke workshops (leathercraft, furniture) run on WhatsApp. A client sends a vague request, a napkin sketch or a voice note, and the crafter spends hours turning that into a design, a price and a cutting plan. CraftMind AI is an AI studio team that does the drafting: it consults the client, proposes original design directions, renders concept mockups, works out the pattern, material and stock, and prepares the quote. **The crafter approves everything before the client sees it.**

| Input (WhatsApp) | CraftMind AI output |
| --- | --- |
| Text, voice notes, rough sketches, reference photos | Structured, category-aware specification (`OrderPayload`) |
| "Something elegant for work" | Up to 3 original design directions in plain words ("Clean & Logo-Free", "Structured & Classic", "Practical & Organized"), never a brand |
| "Like a Birkin, but…" | Taste kept, copy refused: an original concept with its own signature detail |
| "Fits a 14-inch laptop" | Studio concept mockups from 3 angles (exterior, interior, detail), staged for crafter approval |
| "Brown veg-tan, 30x10x22" | 2D pattern pieces, material **SqFt** with wastage, hardware, labor hours, stock match or special sourcing |
| (crafter reviews) | One-click approval sends the mockups and a formal quotation over WhatsApp |

The client chats in English or Indonesian; the assistant always replies in clear, professional English.

## Architecture

```
WhatsApp ─► Webhook ─► Takeover gate ─► Adaptive debounce ─► Orchestrator (one pipeline per order)
                │                                                │
                │ FULL_MANUAL / PARTIAL_PAUSE                     ├─ Intake agent      Gemini Flash · responseSchema · multimodal
                └─► logged for the crafter                        ├─ Direction agent   10 abstract design directions, ranked per client
                    (silent background parse)                     ├─ Visual agent      Gemini image / Imagen · 3 angles · geometry lock
                                                                  ├─ Design critic     Gemini Pro vision · 10 criteria · max 2 revisions (optional)
                                                                  ├─ Pattern agent     Gemini Pro pieces → deterministic SqFt, labor, price
                                                                  └─ Inventory agent   stock match · sourcing fee & lead time
                                                                          │
                                         Crafter dashboard ◄─ held mockups + spec + quote ─► Approve & send ─► WhatsApp
```

- **AI proposes, the maker decides.** New mockups are never auto-sent: they are staged on the dashboard ("Client request vs AI mockup") until the crafter clicks **Approve & Send to Client**. The client is told the draft is being reviewed.
- **Original by design.** Brand names never reach the client or the image model; references become a taste signal (likes vs do-not-copy), and every concept carries one original feature, one functional advantage and one craftsmanship detail.
- **Gemini proposes, arithmetic decides.** Gemini suggests pattern pieces; square footage, stock allocation and price are recomputed deterministically, so every number on the quote is auditable.
- **Offline-safe.** Without `GEMINI_API_KEY` every agent has a deterministic fallback (heuristic parser, template patterns, SVG concept), so the full flow runs with no network.
- **Cost guardrails.** Per-session caps on AI replies (20), render rounds (6) and critic passes, a loop detector, and discount negotiation bounded by a floor margin; anything beyond goes to the crafter.

## Human-in-the-loop

| Trigger | Result |
| --- | --- |
| Client asks for a person (`admin`, `crafter`, "talk to a real person", …) | `FULL_MANUAL`, `CLIENT_REQUEST`, hand-over message |
| Crafter replies manually while the AI is on | `PARTIAL_PAUSE` for 30 min, then the AI resumes |
| 3 turns in a row without design context | `FULL_MANUAL`, `CONFUSION_RULE` |
| Out-of-scope request (electronics, protected materials, …) | `FULL_MANUAL`, `NON_STANDARD`, crafter notified |
| Price far below the floor | `FULL_MANUAL`, `PRICE_NEGOTIATION` |
| Dashboard **Take over** / **Pause** / **Resume AI**, or the simulator toggle | Crafter-controlled switch |

While the AI is blocked, messages are logged for the crafter and the spec is still updated silently in the background. A burst of client messages is buffered (adaptive debounce, ≥ 2 s after the last message) and answered once.

## Run locally

```bash
npm install
cp .env.example .env.local   # optional: add GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

- `/`: landing page and the **WA Chat Simulator** (Leather / Wood studio switch, AI Co-Pilot vs takeover toggle, send as client or crafter, sketch and voice-note upload, test scenarios)
- `/login`: crafter login. Demo accounts: `leather_artisan` (leather studio) and `wood_artisan` (furniture studio), password `craft123`
- `/<workspace_id>/dashboard`: draft orders, review screen (spec editor, side-by-side sketch vs mockup, mockup approval, design review, BOM & SqFt, sourcing, quote approval, conversation)
- `/<workspace_id>/dashboard/presets` and `/inventory`: the workspace's own category presets and stock

Each workspace sees only its own orders, inventory and presets.

## API

| Route | Purpose |
| --- | --- |
| `POST /api/webhook/whatsapp` | Inbound WA event `{ phone_number, crafter_id?, client_name_wa?, sender?, order_id?, text?, media? }` |
| `GET` / `DELETE /api/webhook/whatsapp?phone=&crafter_id=` | Session poll (order, messages, `ai_pending`, `concept_pending`) / start a fresh draft |
| `POST /api/ai/orchestrator` | Run the agents now `{ order_id, force? }` |
| `POST /api/ai/mock-generator` | `{ order_id, angles?, adjustment?, angle_index?, custom_angle_prompt? }` crafter re-render |
| `POST /api/ai/pattern-bom` | Pattern, SqFt, stock match and quote |
| `GET /api/orders?crafter_id=&family=`, `GET /api/orders/:id` | Board and detail (cost breakdown, risk flags) |
| `POST /api/orders/:id/recalculate` | Crafter spec corrections → BOM, SqFt, labor and price |
| `POST /api/orders/:id/design-review` | `APPROVE` (send held mockups) / `REGENERATE` / `REJECT` / `RECHECK` |
| `POST /api/orders/:id/takeover` | `{ mode: 'AI_COPILOT' \| 'PARTIAL_PAUSE' \| 'FULL_MANUAL', pause_minutes? }` |
| `POST /api/orders/:id/approve` | `{ quotation_idr?, note?, angles? }` formal quotation + approved mockups + gallery link |
| `GET/PUT /api/crafter-profile`, `/api/inventory`, `/api/presets` | Workspace profile and master data |
| `POST /api/auth/login`, `/api/auth/logout` | Mock crafter session |
| `GET /api/media/*`, `GET /gallery/:id` | Private-bucket media / client gallery |

## Google Cloud

| Concern | Service |
| --- | --- |
| Hosting | Cloud Run (Next.js 16 standalone, `Dockerfile`) |
| AI | `@google/genai`: Gemini API or Vertex AI. Role-based model chains with retry and fallback (`gemini-flash-latest`, `gemini-pro-latest`, `gemini-2.5-flash-image`, `imagen-4.0-generate-001` on Vertex), all env-overridable |
| State | Firestore: `orders` (+ `messages`), `chat_sessions`, `specifications`, `critic_reviews`, `crafter_workspaces` (+ per-workspace `inventory`, `presets`) |
| Media | Cloud Storage: renders, sketches and voice notes (public or private bucket) |
| Secrets | Secret Manager: Gemini API key, session-cookie secret |

### Deploy

```bash
PROJECT_ID=your-project REGION=asia-southeast2 bash scripts/gcp-deploy.sh setup    # once: APIs, Firestore, bucket, IAM, secrets
PROJECT_ID=your-project REGION=asia-southeast2 bash scripts/gcp-deploy.sh deploy   # build from source and deploy
```

The message buffer and per-phone session lock live in process memory, so the service runs as one always-on instance with CPU always allocated (`--min/--max-instances 1 --no-cpu-throttling`). Firestore and Cloud Storage hold all state. Set `DESIGN_CRITIC=on` to enable the automatic critic loop (default off).

## Testing

`scenarios.csv` is the QA matrix (SCN-01..13: vague request → direction cards, replica request, premium + synthetic, undersized laptop bag, critic revision loop, terminology question, human takeover, exotic sourcing, crafter override, furniture site visit, "just draw it", luxury tote, luxury bifold).

```bash
npm run scenarios:build   # scenarios.csv → src/lib/data/scenarios.json
npm run scenarios         # plays every scenario against a running server
npm run typecheck && npm run lint && npm run build
```

See [WALKTHROUGH.md](WALKTHROUGH.md) for setup, troubleshooting and the demo script.
