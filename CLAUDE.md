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
│   │       │   └── [id]/takeover/route.ts    # AI_COPILOT / PARTIAL_PAUSE / FULL_MANUAL switch
│   │       └── scenarios/route.ts            # Test scenarios (from scenarios.csv) for the simulator
│   ├── lib/
│   │   ├── gcp/
│   │   │   ├── gemini.ts             # Google Gen AI SDK Initialization & Wrappers
│   │   │   ├── firestore.ts          # Firestore DB Client & Helper Rules
│   │   │   └── gcs.ts                # Google Cloud Storage Upload Handler
│   │   ├── agents/
│   │   │   ├── intake-agent.ts       # Agent 1: Structured JSON Parsing
│   │   │   ├── visual-agent.ts       # Agent 2: Studio Mockup Generator
│   │   │   ├── inventory-agent.ts    # Agent 3: Stock Matcher & Sourcing
│   │   │   └── pattern-agent.ts      # Agent 4: 2D Component & BOM Breakdown
│   │   ├── spec/
│   │   │   ├── catalog.ts            # Construction types, vision cues, pocket defaults, gathering checklist & planner
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
  * FURNITURE: L x W x H, wood/metal, secondary material, finish/coating, color/stain, joinery, upholstery, seats, assembly.
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
  explicit cm from the client → `EXACT_CM`; furniture that must fit a room with no measurements → `PENDING_SITE_VISIT`
  (dimensions cleared, provisional size at lock, `site_visit_fee_idr` from the preset added to the quote); a reference in
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
  `non_standard_request` or `NON_STANDARD` regex) → `FULL_MANUAL` + `CLIENT_REQUEST`, `escalation_note` with the reason,
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
    (`composeReply`, template fallback). Required topics first (`construction`, `dimensions`, `leather`, plus
    `card_layout` for wallets/card holders), at most 2 questions per bubble, then each form factor's optional
    `detail_topics` (embossing, thread, lining, edge, zipper, strap, hardware) once each. "Terserah" defers a topic to
    workshop defaults; "itu saja" finishes. The spec card is locked only when the plan is `ready`; later messages are
    corrections that re-quote (`+3 cm`, `tambah saku depan`) instead of reopening questions.
12. Testing: `scenarios.csv` is the QA matrix (one client message + expected dimension mode, reference/size, material,
    automation and escalation per row). Context a row assumes (setup turns, crafter replies) and the follow-up answers
    that reach a quote live in `SCRIPT` in `scripts/build-scenarios.mjs`. After editing either run `npm run scenarios:build`;
    verify with `npm run scenarios` against a running server (WALKTHROUGH.md §6). Keep all rows passing offline
    (`GEMINI_API_KEY=` blank) and online (`--pause 12` on a free-tier key).
13. Before finishing any change: `npm run typecheck && npm run lint && npm run build`.

@AGENTS.md
