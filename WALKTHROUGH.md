# CraftMind AI: Operational Manual & Walkthrough

This manual covers how to set up CraftMind AI locally, configure it, run it, fix the common errors, and test it end to end with the scenarios in `scenarios.csv`. It ends with the deployment steps and the competition demo script.

**Contents**
1. [Prerequisites](#1-prerequisites)
2. [Local setup](#2-local-setup)
3. [Environment configuration (`.env.local`)](#3-environment-configuration-envlocal)
4. [Running the app](#4-running-the-app)
5. [Daily operation: crafter workflow](#5-daily-operation-crafter-workflow)
6. [End-to-end test scenarios (`scenarios.csv`)](#6-end-to-end-test-scenarios-scenarioscsv)
7. [Troubleshooting](#7-troubleshooting)
8. [Deploy to Cloud Run](#8-deploy-to-cloud-run)
9. [Competition demo script (3 minutes)](#9-competition-demo-script-3-minutes)
10. [Development checklist (original build phases)](#10-development-checklist-original-build-phases)

---

## 1. Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | 20.9 or newer (22 recommended) | `node -v` |
| npm | 10+ | `npm -v` |
| Git | any | `git --version` |
| Gemini API key | free tier works for chat; image generation needs billing | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Google Cloud SDK | only for deployment | `gcloud --version` |

On Windows, run everything inside WSL2 (Ubuntu), not PowerShell.

## 2. Local setup

```bash
git clone https://github.com/rgunpetrosea/craftmind-ai-gcp.git
cd craftmind-ai-gcp
npm install
cp .env.example .env.local      # then edit it, see §3
npm run dev                     # http://localhost:3000
```

The app runs **without any configuration**. With no `GEMINI_API_KEY`, every agent uses its offline fallback: a bilingual keyword parser, template questions, template pattern pieces and an SVG concept render. Use offline mode for rehearsals; use a key for the real demo.

The in-memory store starts with three demo orders: a sling bag pending approval, a wallet in manual takeover, and approved derby shoes. **Restarting the server resets all data**, unless Firestore is enabled (§3).

## 3. Environment configuration (`.env.local`)

Next.js reads `.env.local` **only at start-up**, so restart `npm run dev` after editing it. Code changes, by contrast, reload automatically.

### Minimum for the live demo

```bash
GEMINI_API_KEY=your_key_from_ai_studio
```

### All variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | AI Studio key. Blank = offline mode. |
| `GOOGLE_GENAI_USE_VERTEXAI` | `false` | `true` = use Vertex AI with Application Default Credentials instead of a key (needed for Imagen). |
| `GCP_PROJECT_ID`, `GCP_LOCATION` | —, `us-central1` | Vertex AI / Firestore project. |
| `GEMINI_FLASH_MODEL` | `gemini-flash-latest` | Intake and vision parsing. |
| `GEMINI_FLASH_FALLBACK_MODEL` | `gemini-flash-lite-latest` | Used when Flash is overloaded (503) or out of quota (429). |
| `GEMINI_PRO_MODEL` | `gemini-pro-latest` | Pattern / BOM. Falls back to Flash, then Flash-Lite. |
| `GEMINI_IMAGE_MODEL` | `gemini-2.5-flash-image` | Mockups and mockup feedback (needs billing). |
| `IMAGEN_MODEL` | `imagen-4.0-generate-001` | Text-to-image, Vertex AI only. |
| `USE_FIRESTORE` | `false` | `true` = persist to Firestore instead of memory. |
| `GCS_BUCKET` | — | Store sketches and mockups in Cloud Storage instead of inline data URLs. |
| `CRAFTER_NAMES` | `fendy` | Comma-separated names; "mau ngomong sama mas Fendy" triggers a human takeover. |
| `PARTIAL_PAUSE_MINUTES` | `30` | How long the AI stays silent after the crafter replies manually. |
| `CONFUSION_STRIKE_LIMIT` | `3` | Turns without progress before the AI hands over to the crafter. |
| `DEBOUNCE_BASE_MS` / `DEBOUNCE_MAX_WAIT_MS` | `4000` / `15000` | How long the AI waits for the client to finish typing a burst. Use `800` for testing. |
| `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID` | — | Optional: also deliver replies through the real WhatsApp Cloud API. |

Never commit `.env.local`; it is git-ignored. Only `.env.example` is tracked.

### Checking that your key works

```bash
set -a; . ./.env.local; set +a
node -e "import('@google/genai').then(async({GoogleGenAI})=>{const ai=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});for(const m of ['gemini-flash-latest','gemini-flash-lite-latest','gemini-2.5-flash-image']){try{await ai.models.generateContent({model:m,contents:'ok'});console.log(m,'OK')}catch(e){console.log(m,'FAIL',String(e.message).slice(0,90))}}})"
```

`OK` for the two Flash models is enough for chat, spec parsing and pattern breakdown. A `429` on `gemini-2.5-flash-image` means mockups will use the offline SVG until billing is enabled.

## 4. Running the app

| Command | Use |
| --- | --- |
| `npm run dev` | Development server on :3000 with hot reload. |
| `DEBOUNCE_BASE_MS=800 npm run dev` | Faster AI replies while testing. |
| `npm run build && npm start` | Production build, as on Cloud Run. |
| `npm run typecheck` | TypeScript check. |
| `npm run lint` | ESLint. |
| `npm run scenarios:build` | Regenerate test fixtures after editing `scenarios.csv`. |
| `npm run scenarios` | Run all end-to-end scenarios against a running server (§6). |

Only one `next dev` can run per folder. If you see "Another next dev server is already running", either use the existing one (the message shows its URL) or stop it with `kill <PID>`.

| Page | What it is |
| --- | --- |
| `/` | Landing page and **WA Chat Simulator** (the client's phone). |
| `/dashboard` | Crafter's draft orders board and order review screen. |
| `/dashboard/configurator` | Category presets: labor rate, wastage, margin, defaults. |
| `/dashboard/inventory` | Leather stock used for allocation and special sourcing. |

## 5. Daily operation: crafter workflow

### 5.1 How the AI gathers requirements

The AI chats with the client over several bubbles before it builds a quote:

1. **Required details first**: model/form factor, size, leather, plus the card-slot layout for wallets and card holders. It asks at most two things per message.
2. **Then optional details, once each**, chosen per form factor: embossing/initials, thread colour, lining, edge finish, zipper, strap, hardware.
3. **"Terserah" / "ikut standar"** for a topic means "use the workshop default" (from the preset). **"Itu saja kak"** means the client is done.
4. Once everything required is known, the AI sends a **spec card**, renders the mockup, breaks down the pattern, matches stock and drafts the quote. The order then moves to **Pending approval**.
5. A later correction ("kurang tinggi 3cm", "tambah saku depan") updates the spec and re-quotes automatically. The AI sends an updated spec card rather than restarting the questions.

The simulator shows this progress in the checklist strip under the header. Green means filled, amber means asked, and `*` marks a required topic.

### 5.2 Reviewing an order (`/dashboard`)

| Card | What to do |
| --- | --- |
| **Header** | **Take over** (AI goes silent), **Pause AI 30m**, **Resume AI**, or **Re-run agents**. Re-running during a takeover recomputes without messaging the client. |
| **Sketch → AI studio mockup** | Compare the client's sketch with the render. The badge shows which engine made the render. |
| **Prompt adjustment** | Type visual feedback, e.g. *"Change to a flat card sleeve, show open card slots from the front view"*, then **Re-generate mockup with feedback**. Only the mockup changes. Past feedback appears as chips you can reuse. |
| **Structured specification (editable)** | Fix anything the AI misread: construction type (e.g. Bifold → Flat card holder), size, leather, pocket layout, thread, edge, embossing, zipper, strap, hardware. Then press **Recalculate BOM & Price**. Nothing is saved until you press it; **Discard** reverts your edits. Blue "AI vision notes" show what the AI saw in the photo. |
| **Material sourcing** | In stock (allocated) or special sourcing, with the fee and extra lead time. |
| **2D pattern components & SqFt** | Every pattern piece with its area; the total includes wastage. |
| **Quotation & approval** | The cost breakdown (leather, hardware, labor, sourcing, customization, margin). Adjust the final price if needed, then **Approve & send quotation**, which sends a formal quote over WhatsApp. |
| **WhatsApp conversation** | Messages outlined in red arrived while the AI was paused and need your reply. Replying here pauses the AI for 30 minutes. |

### 5.3 Human takeover rules

| Trigger | Result |
| --- | --- |
| Client writes `admin`, `crafter`, `manusia`, `pemilik`, a crafter name ("mas Fendy"), or "ngomong/bicara sama …" | `FULL_MANUAL` (client request). The client is told a person will take over. |
| Crafter replies manually while the AI is on | `PARTIAL_PAUSE` for 30 min, after which the AI resumes. |
| 3 turns in a row with no progress | `FULL_MANUAL` (confusion rule). |
| Dashboard or simulator toggle | Manual switch. **Resume AI** answers any client message left waiting. |

## 6. End-to-end test scenarios (`scenarios.csv`)

`scenarios.csv` is the QA matrix: 10 realistic WhatsApp conversations, from a flat card holder (SCN-01) to a human escalation (SCN-10). It feeds both the simulator's scenario player and the automated runner.

### 6.1 Manual run in the simulator

1. Open `/` and choose a scenario from **"pick a test scenario"** under the chat. This starts a fresh chat.
2. Click **Kirim pesan 1/N** to send the client's first message, then **wait for the AI reply** before sending the next. Messages marked *jawaban lanjutan* answer the AI's questions; *revisi setelah spec card* is a correction sent after the quote.
3. Scenarios marked as sending a photo (SCN-01, 02, 04) are more realistic if you attach an image with the 🖼 icon before the first message.
4. When the player says **Skenario selesai**, compare with the expected outcome it shows. Then open `/dashboard` and check the order.

### 6.2 Automated run

```bash
# terminal 1: short debounce so turns are answered quickly
DEBOUNCE_BASE_MS=800 npm run dev

# terminal 2
npm run scenarios                            # all 10
npm run scenarios -- --only SCN-01,SCN-07    # a subset
npm run scenarios -- --base http://localhost:3100 --timeout 120
```

For each scenario the runner prints the conversation, then ✔/✘ for each check and `PASS`/`FAIL`, and exits non-zero if anything failed.

| Scenario | Checks |
| --- | --- |
| SCN-01 Flat card holder | `FLAT_CARD_HOLDER` (not bifold), Epsom, emboss initials, quoted |
| SCN-02 Messenger 14" | `MESSENGER_BAG`, size derived from the laptop, quoted |
| SCN-03 Bifold | `BIFOLD_WALLET`, ID window, burnished edge |
| SCN-04 Padel bag | `PADEL_RACKET_BAG`, special sourcing (2.0mm Pull-Up not in stock) |
| SCN-05 Zip-around | `ZIP_AROUND_LONG_WALLET`, coin zip pocket, gold zipper, Epsom Navy |
| SCN-06 Slouchy tote | `SLOUCHY_TOTE`, special sourcing (olive green not in stock) |
| SCN-07 Camera bag | `CROSSBODY_CAMERA_BAG`, correction "+3 cm height, add front pocket" re-quotes |
| SCN-08 Engraved card holder | `PATTERNED_CARD_HOLDER`, laser engraving |
| SCN-09 Briefcase | `EXECUTIVE_BRIEFCASE`, quoted |
| SCN-10 Escalation | `FULL_MANUAL`, client request |

**Test both modes before a demo:**

- **Offline:** start with `GEMINI_API_KEY= npm run dev`. All 10 should pass.
- **Online:** the normal key. This exercises the vision and natural-language replies. On the free tier, run a subset (`--only SCN-01,SCN-03,SCN-07,SCN-10`) to stay within quota. Gemini can phrase things differently, so read the transcripts as well as the ticks.

### 6.3 Adding or changing a scenario

1. Edit `scenarios.csv`. Client lines in the *Ringkasan Alur Chat WA* column must be written as `Client: '…'`.
2. Optionally add follow-up answers and extra checks for the new ID in `SUPPLEMENTS` in `scripts/build-scenarios.mjs`.
3. Run `npm run scenarios:build`, then `npm run scenarios -- --only SCN-11`.

## 7. Troubleshooting

### AI / API errors (online)

| Symptom | Cause | Fix |
| --- | --- | --- |
| The same template reply ("Supaya desainnya pas, boleh dibantu info: …") every time | Gemini is not being used. The server log shows `ALL Gemini models failed`. | Check the key (§3). Restart `npm run dev` after editing `.env.local`. |
| Log shows `[gemini] gemini-flash-latest attempt 1 failed (503)` | Google is overloaded (temporary). | Nothing to do: the app retries, then uses Flash-Lite. Replies can take 20–30 s. |
| Log shows `failed (429)` | Free-tier quota or rate limit reached. | Wait for the quota to reset, or enable billing on the key's project. |
| `404 … no longer available to new users` | A model ID is retired for new keys. | Point the matching `GEMINI_*_MODEL` env var at a current model. |
| Mockup badge says **Offline concept** / note "cannot apply free-text feedback" | The image model returned 429 (no billing) or failed. | Enable billing, or use Vertex AI (`GOOGLE_GENAI_USE_VERTEXAI=true`). The SVG still follows the construction type. |
| `generateImages … only supported by the Gemini Enterprise Agent Platform` | Imagen called with an AI Studio key. | Expected: Imagen is skipped unless Vertex AI is enabled. |
| Construction type is wrong (e.g. bifold instead of card holder) | Ambiguous text and no photo, or the offline parser was used. | Correct it in the editable spec and press **Recalculate BOM & Price**. With a photo, check the AI vision notes. |

### Local / offline issues

| Symptom | Fix |
| --- | --- |
| "Another next dev server is already running" | Use the URL it prints, or `kill <PID>` and start again. |
| `EADDRINUSE :3000` | `fuser -k 3000/tcp` (Linux/WSL), or `npm run dev -- -p 3001`. |
| Orders disappeared | The in-memory store resets on restart. Use `USE_FIRESTORE=true` to keep data. |
| AI never replies; simulator shows "mengetik…" forever | Check the terminal for errors. Confirm the order isn't in takeover (red/amber strip): press the toggle or **Resume AI**. |
| AI replies after a long delay | The debounce waits for the client to stop typing. Use `DEBOUNCE_BASE_MS=800` for tests; end a burst with "?" or "itu saja kak" to reply immediately. |
| **Recalculate** button greyed out | A required field is empty (the amber warning lists it), or the order is already approved. |
| Scenario runner shows `(no reply)` / timeout | The server isn't running at `--base`, or Gemini is slow: add `--timeout 120`. |
| Scenario fails only online | Gemini phrased or parsed differently. Read the transcript printed above the ✘; fix the prompt in `src/lib/agents/intake-agent.ts` or adjust the scenario's follow-ups. |
| Type or lint errors after pulling | `npm install`, then `npm run typecheck && npm run lint`. |

## 8. Deploy to Cloud Run

```bash
gcloud auth login
gcloud config set project <your-project-id>
gcloud run deploy craftmind-ai --source . --region asia-southeast1 --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=<key>,GCP_PROJECT_ID=<your-project-id> \
  --max-instances 1 --no-cpu-throttling
```

- `--max-instances 1 --no-cpu-throttling` is needed with the in-memory store and debounce timers.
- For durable data, add `USE_FIRESTORE=true` and give the Cloud Run service account the *Cloud Datastore User* role.
- For production, put the API key in Secret Manager (`--set-secrets GEMINI_API_KEY=gemini-key:latest`) rather than passing it as a plain env var.

## 9. Competition demo script (3 minutes)

| Time | Segment | What to show |
| --- | --- | --- |
| 0:00–0:30 | Problem | Artisans lose hours turning WhatsApp chats, voice notes and sketches into specs and quotes. |
| 0:30–1:15 | Multi-turn intake + vision | Simulator → **SCN-01**: attach a card-holder photo. The AI recognises a *flat* card holder (not bifold), asks about embossing, gathers details over several bubbles, then sends the spec card. |
| 1:15–1:45 | Human takeover | **SCN-10**: "mau ngomong sama mas Fendy" → AI goes silent (`FULL_MANUAL`); the order appears under *Needs you*. |
| 1:45–2:30 | Dashboard review | Side-by-side sketch vs mockup → prompt adjustment re-render → change the construction type in the editable spec → **Recalculate BOM & Price** (pieces, SqFt, hours and price update live) → sourcing → **Approve & send quotation**. |
| 2:30–3:00 | Architecture | Gemini Flash (vision + structured output), deterministic planner, pattern/BOM, Gemini image, Firestore, Cloud Run. |

**Before recording:** run `npm run scenarios -- --only SCN-01,SCN-10` once, and make sure the mockup engine badge shows a Gemini engine (billing enabled). Otherwise, present the SVG concept as the offline fallback.

## 10. Development checklist (original build phases)

1. **Phase 1 – Scaffolding:** Next.js App Router + TypeScript + Tailwind; types including `automation_mode`; mock data. ✅
2. **Phase 2 – Core API & agents with takeover logic:** webhook switching logic, keyword escalation, orchestrator with Gemini structured output. ✅
3. **Phase 3 – UI & takeover controls:** WA simulator with takeover switch, dashboard with side-by-side review, BOM/SqFt, approval. ✅
4. **Phase 4 – Enhancements v2:** vision construction types and pocket layout, editable spec + recalculation, mockup prompt adjustment, multi-turn gathering, scenario test runner. ✅
5. **Phase 5 – Deploy & record:** §8 and §9.
