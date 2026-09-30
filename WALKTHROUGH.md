# CraftMind AI: Project Walkthrough & Development Checklist

## Phase 1: Local Setup & Scaffolding (Day 1)
1. Initialize Next.js App:
   ```bash
   npx create-next-app@latest craftmind-ai-gcp --typescript --tailwind --eslint --app
   cd craftmind-ai-gcp
   ```
2. Read CLAUDE.md and scaffold the project files, TypeScript types (including `automation_mode`), and mock database utilities as specified.

## Phase 2: Core API & Multi-Agent Engine with Human Takeover Logic (Day 2)
1. Get a free Gemini API Key from Google AI Studio (aistudio.google.com).
2. Create environment file `.env.local`:
   ```bash
   GEMINI_API_KEY=your_key_here
   GCP_PROJECT_ID=your_project_id
   ```
3. Implement `src/app/api/webhook/whatsapp/route.ts`:
   - Parse incoming WA messages.
   - Check `automation_mode`: Bypass AI if `FULL_MANUAL` or active `PARTIAL_PAUSE`.
   - Trigger escalation if keywords (`admin`, `crafter`) are detected.
4. Implement `src/app/api/ai/orchestrator/route.ts` using @google/genai SDK with Gemini 1.5 Flash structured output to parse WhatsApp chat and sketch images into the OrderPayload JSON interface.

## Phase 3: Interactive UI & Takeover Controls (Day 3)
1. Build `WA Chat Simulator` widget on frontend with:
   - Human Takeover Switch (`AI Co-Pilot` vs `Manual Takeover`)
   - Live testing of keywords like "Mau bicara dengan admin/crafter"
2. Build Crafter Dashboard (`/dashboard`) featuring:
   - Side-by-Side comparison (Original Sketch vs AI Generated Studio Mockup)
   - 2D Pattern Components Breakdown Table & SqFt Leather Calculation
   - Stock Status & One-Click Approval / Takeover Button

## Phase 4: Cloud Run Deployment & Video Recording (Day 4)
1. Deploy to Google Cloud Run:
   ```bash
   gcloud run deploy craftmind-ai --source . --region asia-southeast1 --allow-unauthenticated
   ```
2. Record 3-Minute Competition Demo Video:
   - 0:00 - 0:30: Problem Statement (Artisan WhatsApp overhead)
   - 0:30 - 1:15: WA Simulator Demo (Sketch + Chat -> AI Studio Mockup & Spec Card)
   - 1:15 - 1:45: Human Takeover Demo (Escalation keyword "Bicara dengan admin" -> AI Auto Pause)
   - 1:45 - 2:30: Dashboard Review (Pattern Breakdown, SqFt Calculation, Sourcing, Approval)
   - 2:30 - 3:00: Architecture Overview & GCP Serverless Stack
