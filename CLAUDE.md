# Project Name: CraftMind AI (ArtisanOS)
# Repository Name: craftmind-ai-gcp

## Executive Overview
CraftMind AI is a Gen AI-powered B2B SaaS designed for bespoke leathercraft and high-value artisan micro-manufacturing. It transforms unstructured client inquiries from WhatsApp (text, voice notes, and rough sketches) into structured specifications, studio-quality mockup renders, 2D pattern component breakdowns (with SqFt leather calculation), inventory-matched sourcing, and formal quotations.

## Target Stack & Platforms (Mandatory Rules)
- Frontend: Next.js 14+ (App Router, TypeScript, Tailwind CSS, Lucide Icons)
- Backend: Node.js / TypeScript (Next.js API Routes or Express on Cloud Run)
- AI SDK & Models: Google `@google/genai` or `@google-cloud/vertexai` SDK
  - Gemini 1.5 Flash (Requirement Parsing, Structured Output, Fast Classification)
  - Gemini 1.5 Pro (Complex Pattern Breakdown & Geometrical BOM Reasoning)
  - Imagen 3 / Gemini Multimodal (Visual Concept Mockup Render Generator)
  - Note: the Gemini 1.5 and Imagen 3 IDs are retired. Code uses role-based chains in `src/lib/gcp/gemini.ts`
    (`MODEL_CHAINS.flash` / `.pro` / `.fast`, env-overridable) with retry + fallback; Imagen only works on Vertex AI.
    Every agent has a deterministic offline fallback, so never make a feature depend on an AI call succeeding.
- Database & State: Firebase Firestore (Session Buffer, Inventory, Draft Orders)
- Task Queue / Debouncing: Cloud Tasks / In-Memory Adaptive Debounce Timer
- Deployment: Google Cloud Run / Firebase Hosting

## Repository Structure & File Scaffolding Target
```
craftmind-ai-gcp/
├── README.md                          # Project Documentation for Competition Submission
├── CLAUDE.md                          # Scaffolding instructions and rules for Claude Code
├── WALKTHROUGH.md                     # Step-by-step development & competition walkthrough
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # Landing Page / Product Overview
│   │   ├── dashboard/
│   │   │   ├── page.tsx              # Main Crafter Dashboard (Draft Orders Board)
│   │   │   ├── configurator/
│   │   │   │   └── page.tsx          # Category Master Preset Setup
│   │   │   └── inventory/
│   │   │       └── page.tsx          # Stock & Material Inventory Management
│   │   └── api/
│   │       ├── webhook/
│   │       │   └── whatsapp/route.ts # Simulation API for Inbound WA Events & Switching Logic
│   │       ├── ai/
│   │       │   ├── orchestrator/route.ts # Multi-Agent Execution Engine
│   │       │   ├── mock-generator/route.ts # Imagen 3 / Multimodal Mockup
│   │       │   └── pattern-bom/route.ts    # Pattern & SqFt Calculator
│   │       ├── orders/
│   │       │   ├── [id]/approve/route.ts     # Crafter Approval & WA Outbound
│   │       │   ├── [id]/recalculate/route.ts # Crafter spec correction → BOM, SqFt, labor & price recalculation
│   │       │   ├── [id]/design-review/route.ts # Crafter concept sign-off: approve & release / regenerate / reject / recheck
│   │       │   └── [id]/takeover/route.ts    # AI_COPILOT / PARTIAL_PAUSE / FULL_MANUAL switch
│   │       ├── crafter-profile/route.ts      # Workshop profile (branding + allowed categories)
│   │       └── scenarios/route.ts            # Test scenarios (from scenarios.csv) for the simulator
│   ├── lib/
│   │   ├── gcp/
│   │   │   ├── gemini.ts             # Google Gen AI SDK Initialization & Wrappers
│   │   │   ├── firestore.ts          # DataStore: Firestore (orders, chat_sessions, specifications, critic_reviews, crafter_workspaces) / in-memory
│   │   │   └── gcs.ts                # Cloud Storage media (renders, sketches), private-bucket reads
│   │   ├── workspaces.ts             # Multi-crafter routing: crafter_id, craft_family, session keys
│   │   ├── agents/
│   │   │   ├── intake-agent.ts       # Agent 1: Structured JSON Parsing
│   │   │   ├── visual-agent.ts       # Agent 2: Studio Mockup Generator
│   │   │   ├── inventory-agent.ts    # Agent 3: Stock Matcher & Sourcing
│   │   │   ├── pattern-agent.ts      # Agent 4: 2D Component & BOM Breakdown
│   │   │   ├── direction-agent.ts    # Design directions: recommend, propose cards, read the choice, concept intent
│   │   │   └── critic-agent.ts       # Design critic: 10-criterion scores, improvement instructions
│   │   ├── design-review.ts          # Critic → automatic revision loop (max 2) → hold & escalate to crafter
│   │   ├── spec/
│   │   │   ├── catalog.ts            # Construction types, vision cues, pocket defaults, gathering checklist & planner
│   │   │   ├── directions.ts         # The 10 abstract design directions (customer-facing cards, prompt DNA)
│   │   │   ├── design-dna.ts         # Private design-DNA library, reference analysis, anti-copying, concept prompt lines
│   │   │   ├── critic-criteria.ts    # Critic rubric, gated criteria, threshold (client-safe)
│   │   │   └── describe.ts           # Spec card / pocket / customization text for WhatsApp
│   │   ├── types/
│   │   │   └── index.ts              # TypeScript Interfaces for Orders, Specs, BOM, Takeover
│   │   └── utils/
│   │       └── debounce.ts           # Debounce & Hybrid Trigger Handlers
│   └── components/
│       ├── ui/                       # Tailwind UI Components
│       ├── simulation/
│       │   └── wa-chat-simulator.tsx # Interactive WA Chat Box Component with Takeover Toggle
│       └── dashboard/
│           ├── order-card.tsx
│           ├── side-by-side-preview.tsx # Original Sketch vs AI Mockup
│           ├── spec-editor.tsx        # Editable specification form + "Recalculate BOM & Price"
│           ├── order-detail.tsx       # Review screen incl. mockup prompt-adjustment card
│           ├── design-review-panel.tsx # Design intent, proposed directions, critic scores, crafter sign-off
│           └── bom-table.tsx          # Component Breakdown Table
├── scenarios.csv                      # QA matrix (SCN-01..10), source of truth for E2E tests
└── scripts/
    ├── build-scenarios.mjs            # scenarios.csv → src/lib/data/scenarios.json
    └── run-scenarios.mjs              # Plays every scenario against a running server and asserts
```

## System Interfaces & JSON Schema Definitions

```ts
export interface OrderPayload {
  order_id: string;
  created_at: string;
  crafter_id: string;
  client_info: {
    phone_number: string;
    client_name_wa: string;
  };
  session_state: 'IDLE' | 'REQUIREMENT_GATHERING' | 'PENDING_CRAFTER_APPROVAL' | 'APPROVED';
  automation_mode: 'AI_COPILOT' | 'PARTIAL_PAUSE' | 'FULL_MANUAL';
  paused_until?: string; // ISO Timestamp for Partial Takeover
  escalation_reason?: 'CLIENT_REQUEST' | 'CONFUSION_RULE' | 'CRAFTER_OVERRIDE';
  craft_category: 'SMALL_GOODS' | 'BAG' | 'FOOTWEAR' | 'FURNITURE' | 'CUSTOM_GENERIC'; // mirrors specifications.category
  // Discriminated union: SmallGoodsSpec | BagSpec | FootwearSpec | FurnitureSpec | CustomGenericSpec
  specifications: {
    category: OrderPayload['craft_category'];
    construction_type: string;          // form factor of THIS category, or 'UNSPECIFIED' (unclassified)
    model_name: string;
    notes: string;
    dimension_mode: 'UNSPECIFIED' | 'EXACT_CM' | 'REFERENCE_BASED' | 'PENDING_SITE_VISIT';
    reference_object: string;           // e.g. "Hermès Birkin 30", "iPad Air 11 inch" when REFERENCE_BASED, else ''
    attributes: AttributesByCategory[category]; // isolated per category, see src/lib/types/index.ts
    custom_fields: Array<{ id: string; label: string; value: string; surcharge_idr: number; source: 'AI' | 'CRAFTER' }>;
  };
  material_sourcing: {
    status: 'IN_STOCK' | 'SPECIAL_SOURCING_NEEDED';
    allocated_stock_id?: string;
    sourcing_fee_idr: number;
    additional_lead_days: number;
  };
  pattern_and_bom: {
    components_breakdown: Array<{
      part_name: string;
      qty: number;
      dimensions_cm: string;
    }>;
    estimated_material_sqft: number; // leather hide or wood board surface, incl. wastage
    hardware_list: string[];
    estimated_labor_hours: number;
    suggested_quotation_idr: number;
  };
  media_assets: {
    original_sketch_url?: string;
    ai_generated_mockup_url?: string;
    mockup_engine?: 'gemini-image' | 'imagen' | 'offline-svg';
    mockup_feedback?: string[];   // crafter prompt adjustments, oldest first
  };
  intake?: {                      // multi-turn gathering state, owned by the orchestrator
    asked_topics: string[];       // each optional topic is asked at most once
    last_asked: string[];         // topics in the last AI bubble (to read short answers)
    vision_notes?: string;        // what the vision model saw in the sketch/photo
    processed_message_id?: string;
    question_rounds: number;
  };
}
```

Unset values are `""` / `0` / `false` / `'UNSPECIFIED'`. Stored orders pass through `normalizeOrder()` (legacy flat
specs are migrated); always use `normalizeSpecifications()` before reading attributes.

## Category-Aware Specification Architecture (v3)
- Categories are ISOLATED: never add an attribute to one category for another's sake, never share stored values.
  * SMALL_GOODS: card slots (front/back/central), cash compartments, ID window, coin zip, zipper (zip only), lining, edge, stitching, embossing.
  * BAG: dimensions, gusset depth, laptop size, capacity, structure, main closure, strap type, hardware, pockets, lining, padding, edge, embossing.
  * FOOTWEAR: EU size, width fit, last shape, upper material, toe style, lining, outsole, welt method, heel height.
  * FURNITURE: L x W x H, wood/metal, secondary material, finish/coating, color/stain, joinery, upholstery, seats, assembly;
    built-ins (KITCHEN_SET, WARDROBE, TV_CONSOLE) add hinges & rails, countertop, floor-to-ceiling, appliances (see v15).
  * CUSTOM_GENERIC: dimensions, material, color, intended use, quantity + free `custom_fields`.
- Single source of truth: `src/lib/spec/categories/*.ts`, typed `FieldMap<Attributes>` (compile error if a field is missing or
  mistyped). From it are generated: the dashboard form (`spec-editor.tsx`), Gemini schemas (`spec/gemini-schema.ts`), offline
  parsers (`parse`), the question checklist (`topics`), the spec card (`spec/describe.ts`) and the mockup prompt.
- Adding a category: add a type + attributes interface in `types/index.ts`, a `categories/<name>.ts` schema, register it in
  `CATEGORY_SCHEMAS` (`spec/catalog.ts`), add a preset in `data/category-presets.json` and a template in `pattern-agent.ts`.
- Intake is two-stage: classify (category + form factor, only while unknown or on a product switch), then extract with
  `extractionSchema(category)` so Gemini can only return that category's attributes; unmatched requests → `custom_fields`.
- Dashboard form shows only relevant fields that are filled or required; the rest sit under "+ Add field";
  "+ Add Custom Field" adds key/value rows with an optional surcharge that flows into the quotation.

## Flexible Dimension Rules (v4)
- Clients rarely know centimetres. `dimension_mode` records how the size was established, `reference_object` what it came from.
- Precedence (`resolveDimensionSource()` in `src/lib/spec/dimensions.ts`, runs after every intake turn, Gemini or offline):
  a site visit already selected stays `PENDING_SITE_VISIT` and keeps the client's numbers as the provisional size;
  explicit cm from the client → `EXACT_CM`; furniture that must fit a room with no measurements → `PENDING_SITE_VISIT`
  (provisional size at lock, `site_visit_fee_idr` from the preset added to the quote); built-ins then get their wall runs
  from the text in every mode (`applyWallRuns`); a reference in
  `src/lib/spec/references.ts` (Birkin/Kelly/Speedy, iPad/laptop/A4/passport) → `REFERENCE_BASED` with the table's size
  (MODEL = the model's own size, CONTENT = object + room, deeper with accessories); otherwise Gemini's own inferred reference.
- The reference table is also injected into the Gemini extraction prompt as calibration; add new references there, not in prompts.
- Dimensions typed by the crafter on the dashboard switch the mode to `EXACT_CM` and are never overwritten by the resolver.

## Q&A, Non-Standard Escalation & Mockup Rules (v5)
- Knowledge base: `src/lib/spec/glossary.ts` (edges, stitching, leathers/textures, lining, emboss, welts, joinery, wood finishes).
- A client question (TERMINOLOGY / DESIGN / OTHER, classified by Gemini or `detectQuestions`) is answered FIRST, grounded in
  glossary facts and the current spec, and the related topic's preference is (re)asked; the spec card is NOT locked on that
  turn (a locked card stays locked). PRICE_TIMELINE questions never block the card. A term inside "X itu kayak gimana?" is
  not a choice; "bisa bikin X?" is a request, not a question. Q&A turns are not confusion strikes.
- Requests outside the crafting scope (electronics, safety certifications, protected materials, mechanisms; Gemini
  `non_standard_request` or `NON_STANDARD` regex) → `FULL_MANUAL` + `NON_STANDARD` ("Out-of-scope request"), `escalation_note` with the reason,
  handoff message to the client, `notifyCrafter()` (dashboard + optional WhatsApp to `CRAFTER_WA_NUMBER`).
- Mockups try every model in `MODEL_CHAINS.image`; only when all fail is the offline SVG used, and
  `media_assets.mockup_error` tells the crafter why (free-tier keys have image quota 0 → billing required).

## Multi-Angle Mockups & Client Delivery (v7)
- 3 angle SLOTS (`ANGLE_1..3`); each slot's VIEW comes from the category strategy matrix in `src/lib/spec/angles.ts`:
  * SMALL_GOODS: closed/folded exterior · fully open interior (slots + lining) · stitch & edge macro
    (flat card holders: plain outer face · slot face · macro)
  * BAG: front 3/4 hero · side profile (gusset, strap attachment, edges) · top-down open interior
  * FOOTWEAR: lateral profile on display · top-down vamp/laces/toe box · welt & sole macro
  * FURNITURE: isometric in styled room · drawers/doors open (or underside) · joinery/upholstery/handles macro
  * CUSTOM_GENERIC: hero · alternate · detail
- Strict isolation: every field has a visual `zone` ('interior' = card slots, cash compartments, ID window, coin pocket,
  lining, inner pockets, padding). EXTERIOR views get a spec JSON WITHOUT interior fields plus the rule
  "CLOSED FOLDED VIEW ONLY. Do NOT render interior slots, linings, or open compartments. Render front emboss on exterior
  shell if specified." INTERIOR views get everything. Form-factor hints are neutral (never say open/closed).
- Prompt = subject + `PRODUCT SPEC (JSON)` (scoped) + `CAMERA / SHOT` + optional `STRICT RULE` + style.
- Crafter override: `POST /api/ai/mock-generator { order_id, angle_index, custom_angle_prompt }` replaces the shot (spec JSON
  still first, scope FULL), is saved in `media_assets.angle_prompts` and reused until `clear_custom_prompt: true`.
- ANGLE_1 renders first (inline at spec lock), the others in the background with ANGLE_1 as reference image.
- Images retry hard before the offline SVG: 3 attempts per model honouring Google's `retryDelay` on 429, 2 passes over
  `MODEL_CHAINS.image`; only hard quotas (limit 0 / per-day) skip a model. The SVG is the very last resort.
- Renders are re-encoded to ≤1280px JPEG (`compressRender`). Approve sends the quote + selected angles + `/gallery/<id>`.

## Client Intake Voice & Background Parser (v8, "Praxium")
- Reply prompt (`REPLY_INSTRUCTION` in `intake-agent.ts`): grounded Indonesian WhatsApp-seller tone ("Halo kak", "Noted",
  "Bisa banget"), no hype ("Wah seru banget!"), at most one emoji. Every reply is 2-3 bubbles separated by a blank line,
  max 2 sentences each; `shapeBubbles()` (`utils/bubbles.ts`) enforces it and `replyIfStillAllowed()` sends each bubble as a
  separate WhatsApp message. Spec card = ack bubble + list bubble + closing bubble.
- Never ask clients technical specs: every category topic `ask` is a lifestyle/usage question with ≤3 plain choices
  ("biasa bawa laptop ukuran berapa inch", "kulit yang makin lama makin cantik atau yang tahan gores"). Answers are mapped back
  (`parseLeatherPreference`, `parseWoodPreference`, Gemini translation rules); an everyday size answer for wallets/bags
  defers the size topic to the form factor's standard size and goes into the brief.
- Background brief (`OrderPayload.client_brief`: product_type, usage_context, fitment_size, style_preference,
  hardware_requirement, target_deadline, budget) is extracted every turn from client AND crafter messages (Gemini
  `client_brief` + `heuristicBrief`) and shown on the dashboard. During a takeover the webhook schedules `runSilentParse()`
  (debounce key `silent:<order_id>`), which updates spec + brief without replying, locking or changing the takeover state.

## Anti-Repetition Slot Filling (v9)
- Order per turn: parse the WHOLE history into the spec + brief first, then plan, then phrase. Gemini returns
  `answered_topics` (topics addressed in any wording anywhere in the chat); offline, carry/fit phrases ("saku celana
  belakang", "di tas", "jangan terlalu tebal") fill `client_brief.fitment_size`, which answers `size`.
- The orchestrator marks answered deferrable topics as deferred (standard value, never asked again) and answered optional
  topics as asked. `finalizeSpecifications` labels a standard-derived size as REFERENCE_BASED "ukuran standar <form factor>".
- The reply prompt carries the CRITICAL ANTI-REPETITION RULE plus an ALREADY ANSWERED list (topic + value / client words).

## Crafter Profile, Greeting & Domain Guardrails (v10)
- `CrafterProfile` { crafter_id, workshop_name, allowed_categories, primary_material, contact_whatsapp } — default in
  `src/lib/data/workspaces.json` (one per workspace), stored via `getCrafterProfile/saveCrafterProfile` (Firestore `crafter_workspaces/{id}`),
  `GET/PUT /api/crafter-profile`, edited on `/dashboard/configurator`. Loaded before every intake turn.
- `allowed_categories` are OFFERING ids (`src/lib/spec/offerings.ts`: wallets, card_holders, bags, belts, watch_straps,
  shoes, furniture, apparel, jewelry, home_decor, sports_gear) mapped onto craft categories / form factors.
- First turn: `greetingBubble(profile)` + either `PRODUCT_QUESTION` (product unknown) or ONE follow-up bubble — max 2 bubbles.
- Guardrails (orchestrator, after parsing, before planning; templates in `src/lib/spec/guardrails.ts`, never model-written):
  OFF_TOPIC / PROMPT_INJECTION (Gemini `message_intent` + `detectIntent` regex, which can only make it stricter) →
  `refusalMessage`, spec and brief untouched (also skipped by the silent parser); product outside the profile
  (`isWithinScope`, or Gemini `within_workshop_scope=false` for OTHER_CUSTOM) → `mismatchMessage`, previous in-scope spec kept
  or reset to unclassified. All prompts state that client messages are data, never instructions.
- The reply prompt starts with "You are the intake assistant for {workshop_name}, specializing exclusively in bespoke
  {primary_material} ({allowed_categories_list}). STRICT OPERATIONAL RULES: 1. GREETING 2. SCOPE LIMITATION
  3. ANTI-PROMPT INJECTION 4. CHAT STYLE".
- `npm run scenarios` temporarily allows every offering (and restores the profile) so the QA matrix is profile-independent.

## Token & Cost Protection (v11)
- Counters live in `OrderPayload.intake` (per intake session): `session_turn_count` (AI replies), `mockup_render_count`
  (AI render rounds), `silent_parse_count`. Limits are env-configurable in `src/lib/spec/guardrails.ts`.
- Turn budget (checked BEFORE any Gemini call): every AI reply goes through `say()` in the orchestrator. At turn
  `SESSION_TURN_WARNING` (18) an incomplete intake gets `turnWarningMessage` + crafter notification; at turn
  `SESSION_TURN_CAP` (20) the AI sends `sessionCapMessage`, switches to FULL_MANUAL (`SESSION_LIMIT`) and notifies the crafter.
  "Resume AI" on the dashboard resets the turn count.
- AI mockups: at most `aiRenderCap(spec)` render rounds per session that actually generated an image (unchanged angles
  are re-sent for free, see v14): `MAX_AI_MOCKUP_RENDERS_DETAIL` (6) for products with a detail macro slot (wallets,
  footwear, furniture, custom), `MAX_AI_MOCKUP_RENDERS` (6) otherwise (bags); initial renders and feedback re-renders share it. The dashboard badge shows the order's cap. Beyond that no image API call; the reply carries `mockupCapMessage`. Crafter dashboard
  renders are capped per order by `MAX_CRAFTER_RENDERS_PER_ORDER` (429).
- Loop detector (reason CONFUSION_RULE): evaluated once per DEBOUNCED turn on the combined burst (+1 per turn, never per
  raw message). Design context resets the counter to 0: feedback / corrections ("salah", "revisi", "maksudnya ..."), a
  change request, product / material / colour / feature / size words (`hasDesignContext()` in `spec/guardrails.ts`),
  a new or settled spec detail, or a question we answer. Strikes: off-topic / injection / nonsense turns, turns with no
  spec context while gathering, frustration with nothing about the design ("ga nyambung"). Post-spec-card small talk is
  neither. `LOOP_STRIKE_LIMIT` (3) consecutive strikes → `loopHandoverMessage`. "Resume AI" (dashboard or simulator
  toggle) clears the reason, note and strike counter.
- Hand-over texts are templates with the tenant variable `{{active_crafter_name}}` (`HANDOVER_TEMPLATES`,
  `HANDOFF_MESSAGES`), bound per order by `renderTemplate(template, profile)` to the crafter profile's honorific + name
  (fallback "crafter kami"). Never hardcode a crafter name.
- Silent background parsing stops after `SILENT_PARSE_CAP` (20) per session.

## Draft Mockups In Chat & Automatic BOM (v12)
- Mockups are NOT an after-confirmation / production step. `generate_mockup_tool` (`src/lib/agents/tools.ts`) is declared to
  Gemini in `composeReply` (function calling via `generateTextWithTools`) and is ALSO fired deterministically by the
  orchestrator, so it works offline: the client asks for a picture (`VISUAL_REQUEST`), the model calls the tool, or the
  core spec just became complete (no required topic missing, nothing rendered yet). It renders the target angle(s) and
  sends them to the client as WhatsApp images (angle targeting and quota rules: v14).
- Each `MockupRender.signature` = `mockupSignature(finalSpec, angle, customPrompt)`: construction + the slot's view + the
  spec fields that view may show, on the FINALIZED spec (workshop defaults filled). At lock, default angles whose render
  still matches are reused (only the background angles render); a different look re-renders.
- recalculate_bom_and_price() is automatic: `quickQuote()` (finalize → `templatePattern` → `assembleQuote`, no AI) runs on
  every gathering / Q&A turn as soon as the size (L x W x H, or EU size for footwear) and the primary material are known.
- `completeForBom()` runs right after intake: a partly given size gets the form factor's default axes (belts / watch
  straps: thickness H = 0.3 cm; "110 x 4" on a strap = length x width), and a generic material ("kulit", "cokelat tua",
  "kayu") becomes the closest stocked item via `resolveGenericMaterial()`: a requested colour is never swapped (no stock in
  that colour → stays generic → special sourcing), otherwise `preset.default_stock_id`, otherwise the best-stocked item.

## Message Buffering & Single-Response Guarantee (v13)
- Buffer window: the adaptive debouncer (`utils/debounce.ts`) never flushes sooner than `DEBOUNCE_MIN_MS` (2000) after the
  client's LAST message, flush triggers ("?", price, mockup) included, so "Halo, selamat sore!" + "Di sini terima bespoke
  order ya?" become one input and one reply. `BUFFERED_FOR_AI` returns `buffered_messages` + `combined_input`.
- The turn's input is `currentBurst()` (`intake-agent.ts`): every client message after `intake.processed_message_id` and
  after the last crafter reply, even if an AI reply landed in between. Nothing new and the chat doesn't end on a client
  message → the run returns `NOTHING_NEW` without replying (this was the duplicate-reply bug: a rerun used to answer an
  empty burst again).
- One pipeline per order (`runOrchestrator` in-flight map + one rerun). A client message that arrives mid-run supersedes
  it: checked after intake (skips composing) and in `say()` before the first bubble. The run then throws
  `SupersededError`, rolls back the orchestrator-owned fields and loop strikes it changed, sends nothing, and the next
  flush answers the whole burst. Once the first bubble is out the bubble set is completed. Forced recomputes are never dropped.
- The webhook handles events per phone number under `withSessionLock()` (`utils/session-lock.ts`), so concurrent messages
  can't create two draft orders or interleave writes. Both the lock and the debouncer are in-process (single instance).

## Mockup Angle Targeting & Render Quota (v14)
- `generate_mockup_tool` args: `reason`, `angle_id` (1..3, described per order with the category's own views via
  `mockupToolDeclaration(spec)`), `adjustment` (visual change the spec can't hold). Target slots (`targetAngles()`):
  explicit view in the client's words (`angleForRequest()` in `spec/angles.ts`: "posisi terbuka" / "bagian dalam" /
  "slot kartu" → the category's INTERIOR slot, e.g. ANGLE_2 for wallets, ANGLE_3 for bags; "detail jahitan" → DETAIL;
  "tampak luar" → ANGLE_1) > the model's `angle_id` > `defaultMockupAngles()` (SMALL_GOODS and BAG: a PAIRED render of
  the closed exterior + the open interior, ANGLE_2 for wallets / ANGLE_3 for bags; others: ANGLE_1). `VISUAL_REQUEST`
  also matches view requests.
- Quota: an angle whose render signature still matches and gets no `adjustment` is re-sent without an image call
  (`reusableRender()`; an offline concept left by a failed call is retried). `mockup_render_count` (the "AI renders X/6"
  badge) goes up by ONE per tool call, and only when a real image (not offline-svg) was generated for a requested angle.
  Over the cap, reusable angles are still sent, nothing is generated, and `mockupCapMessage` follows.
- Background angle renders skip angles whose render is still current.
- REQUIRED SPEC GATE: no mockup while `missingRequired()` is non-empty, for every trigger (picture request, model tool
  call, first draft, revision); checked in the orchestrator (`mockupGateOpen`) and again inside `executeGenerateMockupTool`
  (NOT_READY). While closed the model is not offered the tool and only asks; an early picture request gets "Gambarnya
  langsung aku kirim begitu beberapa detail ini lengkap ya kak." Slots are parsed from the latest message before the gate.
- Spec confirmation (lock) renders `confirmationMockupAngles()` in ONE batched call
  (`generate_mockup_tool({ angles: [1, 2, 3] })`, one render round): wallets closed + open interior + stitch & edge macro,
  bags their pair, footwear / furniture / custom hero + macro. The model passes `angles` (array) too and must never call
  the tool once per angle. Each angle is still its own image request inside that call (image models return one image).
- Revisions: after the client has seen a draft, a change request (`CHANGE_REQUEST`: ganti / ubah / jadiin / tambah /
  hapus / ga usah ...) re-renders in the same turn: the reply acknowledges it (`composeReply({ mockupComing })`, template
  "Siap kak, gambarnya aku sesuaikan dulu ya."), then the tool runs. A change the spec captured re-renders the views it
  touches; one it didn't is stored as a `Revisi visual N` custom field (kept for production and later renders) and sent
  as the adjustment, re-rendering only the view it names ("slot kartu" → interior). Counts as progress, not a loop strike.
- Custom fields reach the image prompt (`custom_requests` in `visualSpec`) with a zone from `customFieldZone()`, so
  interior requests never leak into closed views and every custom request changes the right angle's signature.
- Frame & orientation (`mockupFrame()` in `visual-agent.ts`): a tall small good (LONG_BIFOLD_WALLET, a closed face
  ≥ 1.4x as tall as wide, or "panjang / long / tall" in the spec) renders VERTICAL: `imageConfig.aspectRatio` 2:3 for closed
  and detail views, 3:4 for the opened spread (Imagen: 3:4), plus a `FRAMING:` prompt line ("tall long bifold wallet,
  vertical orientation, breast pocket wallet"). Everything else (incl. the landscape zip-around) stays 1:1. A non-square
  frame is part of the render signature.
- LONG_BIFOLD_WALLET (`categories/small-goods.ts`, before BIFOLD_WALLET): "dompet/bifold panjang", "long wallet",
  "breast pocket", "dompet jas"; "panjang 11 cm" is a measurement, not this. A bifold the client calls long ("yang panjang
  aja") is upgraded in `runIntakeAgent`. `completeForBom` gives it 9.5 x 2 x 19 cm (REFERENCE_BASED "ukuran standar dompet
  panjang") unless the client typed cm, replacing an inherited short-bifold size.
- Images are sent as each angle finishes (`renderMockupAngles({ onRender })`), in slot order; a render error sends a short
  apology and notifies the crafter instead of leaving the chat on the acknowledgment. The cap message is sent once.
  The simulator groups consecutive AI images into one album bubble.

## Built-in Interior Cabinetry (v15)
- `BUILT_IN_FURNITURE` / `isBuiltInFurniture()` (`categories/furniture.ts`): KITCHEN_SET, WARDROBE, TV_CONSOLE, detected
  before CABINET / SHELF ("lemari pakaian", "rak tv"). Topics may now `excludes` form factors as well as `applies_to` them.
- Built-in questions only, ALL REQUIRED (mandatory slots): size (wall width, up to the ceiling or not, else site visit),
  board core (`material`: plywood / multipleks vs blockboard, mapped by `parseBoardPreference`), finishing `board_finish`
  (HPL / duco / melamic), hinges & rails `hardware` (standard / soft-close / Blum-Hafele; "slow-motion", "peredam" →
  soft-close), `countertop` (kitchen only; free text "Material (stone / colour)" via `parseCountertop`: "granit hitam Nero
  Marquina" → "Granite (Nero Marquina)"). "Terserah" still defers them to the form factor's defaults.
  Joinery ("permanen vs bongkar pasang"), knock-down assembly, seats and upholstery are excluded / hidden for built-ins.
- Inventory has board stock (`STK-BD-PLY-18` plywood 18mm, `STK-BD-BLK-18` blockboard 18mm); a generic "kayu" on a built-in
  resolves to plywood. Pattern: module-based cut lists (`builtInCabinetry`), hinges / rails / handles counted per door and
  drawer, countertop and HPL sheets on the hardware list; duco x1.25 labor, HPL / melamic x1.1.
- Kitchen layout fields: `layout_shape` (STRAIGHT / L_SHAPE / U_SHAPE / GALLEY), `second_wall_cm` (L2; `dimensions_cm.length`
  is L1, width the 60 cm depth), `layout_notes` (window / fridge / hob positions). `parseWallRuns` reads "L1: 300, L2: 200,
  H: 240", "dinding 1/2", "bentuk L 3m x 2m tinggi 2,4m" (metres converted); `applyWallRuns` fills and repairs misreads.
- Cut list (`builtInLayout` / `builtInCabinetry`): `kitchenRun()` aggregates walls (L: L1 + L2 - depth, e.g. 300 + 200 - 60 =
  440; U: L1 + 2 x L2 - 2 x depth; galley: L1 + L2); countertop, backsplash and cabinet runs use it (minus a 100 cm fridge
  bay). Wall cabinets are 80 cm, or full height (H - 85 base - 60 splash) when `floor_to_ceiling` or H >= 240. A fridge
  adds 2 tall enclosure panels (H x depth, e.g. 240 x 60) + top bridging panels and a bridge door; L / U add corner panels.
- Full height is ONE rule, `isFullHeightBuiltIn()` (`floor_to_ceiling`, ceiling words anywhere in the spec, or H >= 240), used
  by the cut list, MASTER LAYOUT, HARD CONSTRAINTS and the offline SVG; "sampai plafon" in the chat always sets
  `floor_to_ceiling` (`applyWallRuns`) and an unknown height becomes the 240 cm standard ceiling (`ceilingHeightCm`).
- HARD CONSTRAINTS (`builtInHardConstraints()`), re-read from the stored spec every time the tool runs: "wall cabinets
  extending fully to the ceiling line (2.4m height), zero gap above cabinets, flush to ceiling", the fridge enclosure and
  other appliances, the L / U / galley runs. They head the prompt, override any default template and any reference image
  (sketch, previous render, master shot), are re-checked in a final "CHECK BEFORE FINISHING" line, and are part of the
  render signature together with `BUILT_IN_PROMPT_VERSION` (bump it when the built-in prompt changes).
- Mockups, geometry lock: ANGLE_1 is the Perspective Master Shot; every angle's prompt carries the same `MASTER LAYOUT`
  (`builtInLayoutPlan()`: shape, runs, window near the left corner, tall fridge unit at the right end, sink, hob,
  ceiling; client `layout_notes` win), derived angles get the master image plus a GEOMETRY LOCK instruction. ANGLE_2 =
  "same exact kitchen as Angle 1, doors open 90 degrees" + NEGATIVE "no layout changes, no moving windows, no new wall
  structures...". Confirmation sends one `generate_mockup_tool({ batch_job: [{angle:1},{angle:2,derived_from:1},
  {angle:3,derived_from:1}] })`; a stale master is re-rendered first in the same call and its derived angles follow it.
- Mockups (`visual-agent.ts`): subject "built-in ... installed in a <room>", `BUILT_IN_SCENE` (realistic architectural
  interior photo, eye-level, window daylight + downlights, no isometric / cutaway), eye-level views per room in
  `angles.ts` (installed · doors & drawers open · finish & hardware macro), frame 3:2 (kitchen, TV wall) / 3:4 (wardrobe).
  `interiorSpatialRules()` adds a `SPATIAL RULES:` line: "sampai plafon" / `floor_to_ceiling` → "floor-to-ceiling built-in
  cabinetry, no top gap, wall-mounted upper cabinets flush with ceiling"; "kulkas 2 pintu" / refrigerator → "includes a
  modern stainless steel side-by-side double door refrigerator fitted inside the tall cabinet enclosure" (1 pintu → single
  door); hob + hood, oven, microwave, sink, TV; kitchen proportions; eye-level indoor perspective.

## Furniture Add-ons & Discount Negotiation (v16)
- Add-on catalog `src/lib/spec/addons.ts` (FURNITURE): recessed LED strip / under-cabinet lighting (per metre of cabinet
  run), touch / motion sensor switch, pop-up power socket, magic corner, carousel, pull-out rack. `applyAddOns()` runs after
  every intake turn and records each as a custom field (kind ADD_ON, surcharge = price x qty; preset `addon_prices_idr`
  overrides), so the BOM / quote recalculates; the hardware list shows them as "(add-on)" (not priced twice).
- They are never out of scope: add-on phrases are removed before the NON_STANDARD check, a Gemini non-standard flag about
  them is dropped, and "stop kontak dengan ..." no longer matches the talk-to-a-human pattern. Real out-of-scope requests
  escalate with reason NON_STANDARD; only explicit requests for a person use CLIENT_REQUEST.
- Discounts (`agents/negotiation.ts`, orchestrator branch before Q&A, only when the required spec gate is open):
  floor = cost x (1 + `floor_margin_pct`, 0.15); AI cap = min(quote - floor, quote x `max_auto_discount_pct`, 0.05).
  Requested price (`requestedPrice`: "diskon 10%", "jadi 30 juta", "potong 2 jt") > 20% below the floor with NO new
  add-ons → FULL_MANUAL + PRICE_NEGOTIATION + crafter notified. Below the floor otherwise → polite hold (at most the cap).
  New add-ons whose cheapest fits the cap → that add-on free; else a discount up to the cap. The offer is stored as one AI
  custom field (kind DISCOUNT, negative surcharge, replaced each negotiation turn); negative surcharges are taken off after
  the margin (`discount_idr` in the breakdown). Reply: add-ons noted + costs rise → updated quote + offer / hold →
  "Harga final tetap dikonfirmasi {{active_crafter_name}} di penawaran resmi". Before the gate opens, prices are not given.

## Design Intelligence Layer v2 (v17, `docs/Praxium_CraftMind_Design_Intelligence_Layer_v2*.pdf`)
- Pipeline: discover intent → propose abstract directions → generate → critique & revise → crafter approval → present.
  The assistant is a Bespoke Design Consultant / Product Design Director (reply prompt), the crafter is the final authority.
- Spec-level design intent (every category, kept on a category switch): `design_direction`, `secondary_direction`,
  `originality_feature`, `functional_advantage`, `craftsmanship_detail`, `reference_likes`, `reference_do_not_copy`
  (`normalizeDesignIntent()` in catalog). Order-level `design_review`: `critic_scores`, `decision`, `revision_number`,
  `crafter_status`, `history`, `held_angles`. `intake.proposed_directions` = card order shown to the client.
- Directions (`spec/directions.ts`): 10 abstract, customer-facing languages (Quiet Luxury ... Modular Utility). NEVER a brand
  name in anything the client sees. Explicit names in the chat set the direction; loose adjectives ("elegan") don't.
- Direction gate: BAG, SMALL_GOODS, FURNITURE have a required, deferrable `direction` topic with `solo: true` (asked alone,
  after every other required topic), so no mockup renders before a direction is chosen (required spec gate). The Direction
  Agent (`agents/direction-agent.ts`, pure, offline) ranks directions (named > reference taste > lifestyle cues > form
  factor > material), and `composeReply({ directionProposal })` sends ack + one light card-list bubble ("Biar gambarnya
  pas, kakak lebih suka nuansa yang mana?" + ≤3 lines `*feel*: pitch`, one short sentence each, no jargon, recommendation
  first) + the reason it fits and "pilih nomornya, atau bilang 'pilihin aja'". Each direction has a customer-facing
  `feel` ("Kalem & Tanpa Logo", "Bentuk Tegas & Klasik", "Seni & Unik"...), a `pitch` and `answer_words`; the design-language
  `name` and the full card (use fit, silhouette & material logic, original feature, benefit, trade-off) are dashboard
  and prompt material. Spec card / concept captions say "Nuansa desain: <feel>". `applyDirectionAnswer()` reads "yang
  kedua", "gabung 1 dan 3", "quiet luxury aja", "yang kalem aja" (feel words, shown cards first), "boleh / terserah /
  pilihin aja / ikut rekomendasi" (→ the recommendation); extra wording becomes a "Penyesuaian arah desain" custom field.
  Gemini's `answered_topics` never settles the direction; an explicit deferral takes the top recommendation
  (`resolveDirection`, also in `finalizeSpecifications`).
- Non-blocking default: while the direction is open, a picture request (`VISUAL_REQUEST`) or "leave it to you" input
  (`AUTO_DECIDE`: "langsung gambarin", "gambarin aja", "pilihin aja", "terserah", "ikut rekomendasi") never waits for the
  cards: the orchestrator applies the top recommendation, defers every open deferrable required topic (standard size, card
  layout, built-in finishes...), fills a missing material with the house material (`withHouseMaterial` → `completeForBom`)
  and the mockup renders that turn. Only what has no default (the product itself, a furniture size) is still asked.
- Anti-marketplace rule: `completeDesignIntent()` guarantees one proposition (direction), one original feature (from the
  direction card per category family unless the client gave their own), one functional advantage, one craftsmanship detail.
  `designRiskFlags()` reports contradictions (premium + synthetic leather, laptop bag smaller than the laptop, too many
  materials, reference without an original feature) to the critic and the dashboard; `designAdvisories()` tells the
  client the first two (each once, its own bubble after the turn's reply; nothing is changed for them).
- First turn with a client question: greeting + answer bubble + question bubble (the answer is never dropped); a
  comparison question ("bedanya Epsom sama veg-tan?") gets the key sentence of each glossary term in one bubble.
- Design DNA (`spec/design-dna.ts`): the brand list is a PRIVATE research library (never prompted, never offered).
  `designPromptLines()` adds DESIGN DIRECTION (abstract dna), DESIGN DNA (category principles; built-ins their own),
  CONCEPT (proposition, original feature, functional advantage, craftsmanship), MATERIAL QUALITY (satin full-grain
  calfskin, hand saddle stitching, polished solid brass for leather; timber equivalents for furniture; the spec's own
  material / colour / hardware win), ORIGINALITY (no copy, no logos / monograms / proprietary patterns + the do-not-copy
  list) and AVOID (anti-marketplace list). A client reference image with do-not-copy items is attached with
  `REFERENCE_IMAGE_RULE` (taste only). Bump `DESIGN_PROMPT_VERSION` when these lines change (part of the render signature,
  with the design-intent fields). Mockup prompts now use the finalized spec (the signature already did).
- Anti-copying: `analyzeReferences()` splits a named brand / product into likes vs do-not-copy (+ taste directions);
  "persis / replika / KW / 1:1" (not "ga mau persis") → `originalityNotice()` prepended to the reply (or the cards).
- Design critic (`agents/critic-agent.ts`): separate pass after every render, before the client sees it; MODEL_CHAINS.pro
  vision model scores 10 criteria 0-100 (+ strengths, weaknesses, improvement instructions, views to revise). The code
  decides from the scores: gated criteria (Premium Perception, Originality, Visual Identity, Proportion and Balance, View
  Consistency) all ≥ `CRITIC_THRESHOLD` (80) → APPROVE. Offline / only SVG concepts / call failed → `heuristic` spec-level
  check: never re-renders, never holds, only flags NEEDS_REVIEW. `DESIGN_CRITIC=off` disables the layer.
- Improvement loop (`design-review.ts` `reviewConcept`): client-facing renders (generate_mockup_tool) are collected, not
  streamed; failing → regenerate only the critic's views among the ones just rendered (`renderMockupAngles({ revision })`,
  label "DESIGN DIRECTOR REVISION n", not recorded as crafter feedback, not counted in the client render cap), max
  `MAX_CRITIC_REVISIONS` (2). Still failing → renders held (`held_angles`), client gets `CONCEPT_HOLD_MESSAGE`, crafter
  notified with the score breakdown, status NEEDS_REVIEW, tool status HELD. Background angles: same loop, nothing held.
  Crafter dashboard renders: scored only. Cost cap `MAX_CRITIC_PASSES_PER_ORDER` (24).
- Concept jobs: the orchestrator never awaits generate_mockup_tool; `enqueueMockupTool()` runs it (render + critic loop)
  in the background, one job at a time per order, so the turn ends (`ai_pending` false) and the client can keep chatting.
  Session GET exposes `concept_pending` (simulator: non-blocking "Menyiapkan gambar konsep…" status, cleared when the job
  sends the images / draft / hold message); `rendering_angles` on the order detail covers concept jobs too.
- Best pass & drafts: every pass keeps the renders it judged; on a final failure the highest aggregate (sum of 10 scores)
  pass's renders are restored as current (`best_pass_revision`). If the client explicitly asked for a picture
  (`clientAsked`: VISUAL_REQUEST, AUTO_DECIDE, or the design direction chosen / confirmed / changed on this turn —
  "nomor 1", "ikut rekomendasi", "yang kalem") that best pass is sent with `DRAFT_CONCEPT_MESSAGE`
  (`draft_released_angles`, crafter status NEEDS_REVIEW, crafter notified); otherwise the renders are held as before.
- Revision prompts: the critic returns `render_positive` (MUST SHOW descriptors) and `render_negative` (generic MUST NOT
  SHOW elements, never brands); `runVisualAgent({ revision })` puts a DESIGN REVISION block with them at the TOP of the
  prompt plus a final CHECK line; non-fresh revisions edit the previous image, fresh ones (originality / identity failed)
  start over. All prompts pass through `scrubReferences()` (no brand / iconic product names reach the image model).
- Crafter review (`POST /api/orders/[id]/design-review`): APPROVE (releases held renders with `conceptPresentation()`:
  direction, original feature, material, benefit, pending items, "bukan jaminan hasil produksi final"), REGENERATE (note =
  change request, then scored), REJECT, RECHECK, UPDATE_DESIGN. Approving the quotation also signs off the design. The first
  concept image caption is `conceptIntro()` (direction + original feature + "konsep visual, dicek crafter").

## Google Cloud Infrastructure & Multi-Crafter Workspaces (v18)
- `USE_FIRESTORE=true` → `FirestoreStore` (firebase-admin, ADC); otherwise `MemoryStore`. Both implement `DataStore`;
  `getStore()` wraps any (even an older hot-reloaded) instance with order normalization and fallbacks for newer methods.
- Firestore collections (`COLLECTIONS` in `gcp/firestore.ts`): `orders/{id}` (+ `messages` subcollection, the transcript),
  `chat_sessions/{session_key}`, `specifications/{order_id}` (spec projection written with every `saveOrder` in one
  batch), `critic_reviews/{review_id}` (every critic pass via `appendCriticReview`, logged by `design-review.ts`; the
  order keeps the latest 10), `crafter_workspaces/{crafter_id}`, `inventory`, `presets`. Legacy `conversations` /
  `crafters` documents are still read as fallbacks. Queries use single-field filters only (no composite indexes);
  ordering happens in memory. `saveOrder` warns above 900 KiB (inline images; set `GCS_BUCKET`).
- Workspaces (`lib/workspaces.ts`): every order carries `crafter_id` + `craft_family` (LEATHER | FURNITURE; derived by
  `craftFamilyOf()`, an unclassified order keeps its workspace's main trade from `familiesOf(profile)`). Inbound events are
  routed by `crafter_id`, else `to_phone_number_id` → the workspace's `wa_phone_number_id`, else `DEFAULT_CRAFTER_ID`.
  Chat sessions and the per-phone session lock use `sessionKey(phone, crafterId)` (plain phone for the default workspace,
  `<crafter_id>__<phone>` otherwise). Always pass `order.crafter_id` to `getConversation`. `GET /api/orders?crafter_id=&family=`,
  `GET/PUT /api/crafter-profile?crafter_id=` (`?all=1` lists workspaces), webhook GET / DELETE take `crafter_id`.
- Cloud Storage (`gcp/gcs.ts`): with `GCS_BUCKET`, renders (`storeMedia`) and inbound sketches / voice notes
  (`persistInboundMedia`) are uploaded (immutable cache headers) and documents hold URLs; an upload failure falls back to
  an inline data URL. `GCS_PUBLIC_READ=false` → private bucket served by `/api/media/[...path]` (orders/ only).
  `mediaUrlToPart` reads our own objects through the SDK (lazy import, avoids a module cycle), so private media still
  reaches Gemini as reference images.
- Cloud Run: `output: "standalone"`, `Dockerfile` (node 22 bookworm-slim, sharp), `scripts/gcp-deploy.sh setup|deploy`
  (APIs, Firestore Native, bucket, service account roles, Gemini key in Secret Manager). The debouncer and session lock
  are in-process and buffered turns run after the response, so the service runs as ONE always-on instance with CPU always
  allocated (`--min/--max-instances 1 --no-cpu-throttling`). Scaling out needs Cloud Tasks + a distributed lock first.

## Crafter Approval, Mock Auth & Workspace Isolation (v19)
- Mockups never auto-appear in the client chat. `executeGenerateMockupTool` renders (one fast pass; the critic loop only
  with `DESIGN_CRITIC=on`, default OFF), then `stageForApproval()` puts the new angles in `design_review.held_angles`
  with `crafter_status` PENDING_CRAFTER_APPROVAL (NEEDS_REVIEW when the critic failed them), sends the client
  `APPROVAL_PENDING_MESSAGE` ("Draft konsepnya sudah aku buatkan dan sedang ditinjau sebentar oleh Crafter kami...")
  and notifies the crafter. Only already-approved angles are re-sent directly. The dashboard's `MockupApprovalCard`
  ("Client request vs AI mockup") shows the client's words + locked spec next to the held renders; "Approve & Send to
  Client" = design-review APPROVE (sends them with `conceptPresentation`). The crafter can still force the critic
  (RECHECK / REGENERATE pass `force: true`).
- Intake locks explicit details before any draft: BAG closure (flap bags), hardware finish, lining and laptop size
  (laptop-carrying bag types) and SMALL_GOODS lining are REQUIRED deferrable topics; an optional `visual_reference`
  topic asks once for a photo of the hardware / stitching / interior the client likes.
- Mock auth (`lib/auth.ts`): `/login` → `POST /api/auth/login` checks `crafter_workspaces/{id}.login`
  (sha256("username:password"); demo `leather_artisan` → crafter-leather-01 LEATHER, `wood_artisan` → crafter-wood-02
  FURNITURE, password craft123, seeded from `data/workspaces.json`) and sets the HMAC-signed `cm_session` cookie
  (`AUTH_SECRET`). Dashboard routes are `/[workspace_id]/dashboard`, `/presets`, `/inventory`; their layout redirects
  to /login (no session) or the session's own workspace. Old `/dashboard` redirects.
- Isolation: inventory and presets live per workspace (`crafter_workspaces/{id}/inventory|presets`, MemoryStore per id),
  seeded by `seedForWorkspace()` (leather / hardware / lining stock and leather presets vs teak / mahogany / board /
  iron stock and the FURNITURE preset). `listInventory(crafterId)`, `listPresets(crafterId)`, `getPreset(category,
  crafterId)`; the orchestrator uses `order.crafter_id`. APIs take the workspace from `workspaceFromRequest()` (session,
  else `workspace_id` / `crafter_id` param, else DEFAULT_CRAFTER_ID = crafter-leather-01); a session asking for another
  workspace gets 403, another workspace's order 404 (`orderHidden`). GET /api/crafter-profile is public branding
  (`allowOverride`, login stripped by `publicProfile`).
- Simulator: Leather Studio / Wood Studio switcher; every call carries `crafter_id`. Store singletons are keyed by
  `STORE_VERSION` (bump when the DataStore contract changes).
- Scenarios: follow-ups may be dashboard calls (`APPROVE`, `wait_for_renders`); checks `APPROVAL_STAGED`,
  `SPEC_EXPLICIT:a|b|c`. Rows asserting critic results need the server started with `DESIGN_CRITIC=on`.

## Step-by-Step Task Execution Rules for Claude Code
1. Initialize the Next.js project with App Router, TypeScript, and Tailwind CSS.
2. Install `@google/genai` or `@google-cloud/vertexai`, `firebase-admin`, `lucide-react`, and `clsx`.
3. Implement Human Takeover Logic in WhatsApp Webhook Routing:
   - Check `automation_mode`. If `FULL_MANUAL` or `PARTIAL_PAUSE` (not expired), skip AI response generation and log incoming chat for Crafter review.
   - Implement keyword trigger detector (`admin`, `crafter`, `manusia`, `pemilik`) to automatically switch `automation_mode` to `FULL_MANUAL` and set `escalation_reason: 'CLIENT_REQUEST'`.
4. Create mock JSON datasets for Crafter Stock (`Veg-Tan Brown 1.6mm`, `Epsom Black 1.2mm`, etc.).
5. Build the API routes using Gemini Flash for structured JSON extraction via Gemini's `responseSchema` feature.
6. Create an interactive `WA Chat Simulator` component on the frontend with a toggle switch to simulate switching between AI Co-Pilot Mode and Human Takeover Mode.
7. Build the `Side-by-Side Review Screen` in the dashboard to highlight AI innovation during judging.

## System Enhancement Rules (v2)
8. Vision & spec accuracy (Agent 1): the intake prompt is built from `CONSTRUCTIONS[].vision_cue` (`visionGuide()`), so a new
   form factor is added in `src/lib/spec/catalog.ts` only. The photo outranks the words: a sleeve with no fold line is
   `FLAT_CARD_HOLDER`, never `BIFOLD_WALLET`. Gemini returns `vision_notes`, shown to the crafter on the review screen.
9. Editable specification (HITL): the review screen's spec form (`spec-editor.tsx`) saves nothing until
   "Recalculate BOM & Price" → `POST /api/orders/[id]/recalculate`, which replaces the edited fields, recomputes pattern
   pieces, SqFt, hardware, labor, stock match and quote deterministically (`use_ai: true` for Gemini Pro), and leaves the
   mockup and conversation untouched. It refuses (422) while a required topic is empty and (409) after approval.
10. Mockup re-generation (Agent 2): `POST /api/ai/mock-generator { order_id, adjustment }` appends the crafter feedback to
    the prompt as highest priority, passes the current mockup (and sketch) as reference images, and only updates
    `media_assets`. The offline SVG cannot apply free text; the response then carries a `note` the UI shows.
11. Multi-turn gathering: WHAT to ask is decided by `planConversation()` (deterministic), HOW it is phrased by Gemini
    (`composeReply`, template fallback), always as lifestyle questions (see v8). Required topics first (`construction`, `dimensions`, `leather`, plus
    `card_layout` for wallets/card holders), at most 2 questions per bubble, then each form factor's optional
    `detail_topics` (embossing, thread, lining, edge, zipper, strap, hardware) once each. "Terserah" defers a topic to
    workshop defaults; "itu saja" finishes. The spec card is locked only when the plan is `ready`; later messages are
    corrections that re-quote (`+3 cm`, `tambah saku depan`) instead of reopening questions.
12. Testing: `scenarios.csv` is the QA matrix (one client message + expected dimension mode, reference/size, material,
    automation and escalation per row). Context a row assumes (setup turns, crafter replies) and the follow-up answers
    that reach a quote live in `SCRIPT` in `scripts/build-scenarios.mjs`. After editing either run `npm run scenarios:build`;
    verify with `npm run scenarios` against a running server (WALKTHROUGH.md §6). Keep all rows passing offline
    (`GEMINI_API_KEY=` blank) and online (`--pause 12` on a free-tier key).
    The rows follow the Design Intelligence Layer v2 test list (section 14): vague request → direction cards, replica
    request, premium + synthetic, undersized laptop bag, critic revision loop, terminology question, human takeover, exotic
    sourcing, crafter override, furniture site visit, plus SCN-11 "langsung gambarin" (non-blocking default). Column
    `expected_design_checks` holds `;`-separated assertions (`DIRECTION_CARDS`, `CARDS_SHORT`, `AUTO_DIRECTION`, `CARDS_NO_BRANDS`, `NO_RENDER_BEFORE_DIRECTION`, `DIRECTION_CHOSEN`, `DIRECTION_TASTE:A|B`,
    `ORIGINALITY_NOTICE`, `DO_NOT_COPY`, `RISK_FLAG:x`, `CLIENT_ADVISED:x`, `CRITIC_REVIEWED`, `CRITIC_FAILED:key`,
    `CRITIC_REVISED`, `IMAGES_SENT`, `MULTI_ANGLE`, `CRAFTER_STATUS:S`, `QUESTION_ANSWERED:x`, `NOT_LOCKED_ON_QUESTION`,
    `SOURCING_FEE`, `ANGLE_OVERRIDE:ANGLE_n`), implemented in `designCheck()` of `scripts/run-scenarios.mjs`. A `SCRIPT`
    step can be a crafter-dashboard call (`api(path, body)`, ":order" = the order id; the simulator plays it too).
    `POST /api/orders/[id]/design-review { action: 'SIMULATE_CRITIC', fail_passes }` forces the next critic passes to fail
    (Originality 72, View Consistency 74) so the revision loop runs offline; it is refused in production unless
    `ALLOW_TEST_HOOKS=true`. `GET /api/orders/[id]` returns `risk_flags`.
13. Before finishing any change: `npm run typecheck && npm run lint && npm run build`.

@AGENTS.md
