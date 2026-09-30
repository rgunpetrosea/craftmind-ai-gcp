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
│   │       └── orders/
│   │           └── [id]/approve/route.ts # Crafter Approval & WA Outbound
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
│           └── bom-table.tsx          # Component Breakdown Table
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
  craft_category: 'bespoke_bag' | 'bespoke_wallet' | 'bespoke_shoes';
  specifications: {
    silhouette: string;
    target_capacity: string;
    dimensions_cm: { length: number; width: number; height: number };
    exterior_leather: string;
    lining_material: string;
    structure_temper: string;
    stitching_method: string;
    edge_finish: string;
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
    estimated_leather_sqft: number;
    hardware_list: string[];
    estimated_labor_hours: number;
    suggested_quotation_idr: number;
  };
  media_assets: {
    original_sketch_url?: string;
    ai_generated_mockup_url?: string;
  };
}
```

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

@AGENTS.md
