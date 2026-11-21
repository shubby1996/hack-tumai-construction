# Cats Track – AI site assistant (Tum.ai Construction Hack, Challenge B)

One shared two-week plan for the whole site. Every subcontractor updates their own tasks by voice from the site.
The assistant **flags blockers before they bite** (preventive), **proposes a re-plan when something breaks** (reactive),
and **drafts every notice and report** (VOB/B). The site manager approves re-plans and outgoing documents.

> Prototype with synthetic data. Drafts are a drafting aid, not legal advice.

📄 **Platform explanation:** [`public/platform.html`](public/platform.html), live at [hack-tumai-construction.vercel.app/platform.html](https://hack-tumai-construction.vercel.app/platform.html). Keep it updated with every change (see its changelog section).

## What the MVP does

| Area | What works |
| --- | --- |
| Capture | Voice dictation in German or English (browser speech API, Chrome/Edge/Safari), typing, photos, demo phrases |
| Log format | Timestamp, author, photos, **location**, **current state**, **next steps** (to-do / inform / contact / remind, who, by when). The speaker's own instruction ("in drei Monaten erneut ansprechen") wins over AI suggestions. |
| Extraction | Note → structured diary entry (type, task, cause, responsible party, time, delay) with a small open-source LLM (Ollama, Groq …), Claude, or a rule-based fallback. Asks one follow-up question for missing facts. |
| Photo understanding | A small open vision model (Qwen3-VL) describes each photo: caption, visible findings, text in the image. A photo alone can start a note. |
| Shared plan | Two-week Gantt for 4 subcontractor teams, readiness checklists, milestones, forward-pass scheduling |
| Change control | Foremen change their own tasks freely; impact on other teams and milestones is computed and the affected people are notified |
| Preventive | Daily scan of tasks starting in the next 5 working days, top 3 blockers ranked by due date and milestone criticality, draft request letters, mark cleared |
| Reactive | Stoppage → knock-on effect → re-plan proposal (add crew to recover milestone slip, pull unblocked work forward to avoid idle crews), explained in plain words, approve/reject |
| Documents | VOB/B drafts: Behinderungsanzeige (§ 6 Abs. 1), Mängelanzeige (§ 4 Abs. 7) / Mängelrüge, Mehrkostenanzeige (§ 2 Abs. 5/6), Bedenkenanzeige (§ 4 Abs. 3), Anforderung von Unterlagen (§ 3 Abs. 1), daily report. Edit, approve, export PDF and Word. |
| Plan changes from logs | A delay reported in a log becomes a proposed change; the site manager sees the consequence and accepts or rejects. Foremen's direct task edits stay immediate. |
| Today so far | Site manager's Home: logs, problems, what waits for him, milestones at risk, due to-dos, AI summary on demand, daily report |
| Messages to send | Subs, client and suppliers don't use the app: personalised German WhatsApp / SMS / email drafts (action vs FYI), sent from the site manager's phone |
| Setup | Initialise a site: project data, schedule import from MS Project / Excel (.xlsx, .csv), documents, contacts |
| Meeting minutes | Paste minutes → one log per agenda item with owner and due date |
| Audit trail | Logs view with search and filters, decision log (preventive / reactive / change), change log with who was notified |
| KPIs | Preventive vs reactive decisions today, milestone status |

## Demo script (≈ 5 min)

1. **07:00 – Preventive.** As *Max Bauer (site manager)*, look at “Blockers to clear”: crane double-booked, slab drawings missing from the client, steel for section C unconfirmed. Click **Draft request** on the drawings → review in Documents → Approve.
2. **10:00 – Reactive.** Click demo phrase **Excavator idle (DE)** → *Structure note* → answer “1 day” → *Save*.
3. **Re-plan.** See the proposal: without action the foundation milestone slips 1 day; with the re-plan it holds and ≈72 idle crew-hours are avoided. **Approve**.
4. **Notice.** *Draft obstruction notice* → edit → **Approve** → **PDF / Word**.
5. **11:00 – Change control.** Switch to *Lena Weber (formwork)* → My tasks → *Formwork slab floor 2 A* → +1 day → reason → *Apply*. Switch to *Mehmet Kaya (rebar)*: he is notified, and the milestone warning shows.
6. **11:30 – Call from a sub.** As site manager: **Rebar 2 days late** → Structure → Save. Accept the proposed change in “Today so far”.
7. **Messages.** *Messages to send* → action for rebar/earthworks, FYI for formwork/concrete → send one via WhatsApp.
8. **Instruction wins.** **Basement floor broken** → only a reminder in three months.
9. **Minutes.** Project → Logs → *Import meeting minutes* → sample → save.
10. **17:00 – Report.** Home → *Summarise my day* → *Generate daily report* → export.

Use **Reset demo** in the header to start again.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
npm run check:engine # prints the plan engine's results for the demo scenario
```

## AI models: open source by default

Cats Track talks to any **OpenAI-compatible** chat endpoint, so small open models work without code changes.
Engine priority: open model (`LLM_BASE_URL`) → Claude (`ANTHROPIC_API_KEY`) → built-in rules.

| Job | Default open model | Size | Notes |
| --- | --- | --- | --- |
| Note → structured diary entry | `qwen3-vl:4b-instruct` (or any small instruct LLM, e.g. `qwen3:4b`) | 3.3 GB | JSON mode, grounded prompt, falls back to rules on error |
| Photo understanding | `qwen3-vl:4b-instruct` / `qwen3-vl:2b-instruct` | 3.3 / 1.9 GB | Caption, visible findings, text in the photo; feeds the note and the notice ("Fotobefund") |

**Local, fully offline (Ollama ≥ 0.12.7):**

```bash
ollama pull qwen3-vl:4b-instruct
cp .env.example .env.local   # Option A1 is pre-filled
npm run dev
```

**On Vercel:** Vercel cannot reach a model on your laptop. Use a hosted open-weight endpoint instead (for example the Groq free tier, Option A2 in `.env.example`), set the variables in Vercel → Settings → Environment Variables and redeploy.

## Architecture

```
src/
  app/
    page.tsx              UI shell: persona switch, tabs
    api/extract/route.ts  note (+ photo notes) → structured entry (open LLM / Claude / rules)
    api/vision/route.ts   photo → caption and findings (open VLM)
    api/minutes/route.ts  meeting minutes → log items with next steps
    api/summary/route.ts  "today so far" summary
    api/status/route.ts   which AI engine is active
  components/             Today, DailySummary, Capture, Replan, Plan (Gantt), TaskEditor, Logs, MinutesImport, Outbox, Setup, Documents
  lib/
    ai.ts                 OpenAI-compatible client for open models, JSON parsing, photo analysis
    seed.ts               synthetic site: teams, personas, 14 tasks, milestones, settings
    engine.ts             scheduling, impact, preventive scan, re-plan heuristic
    extract-rules.ts      offline keyword extractor (DE/EN)
    templates.ts          VOB/B notice and daily report templates
    messages.ts           ready-to-send messages for people without the app
    minutes.ts            meeting-minutes splitter (rules)
    schedule-import.ts    MS Project / Excel schedule import
    export.ts             PDF (jsPDF) and Word (docx) export
    store.ts              app state (zustand, persisted in localStorage)
    useSpeech.ts          browser speech-to-text
```

**Design choices for the MVP**

- State lives in the browser (localStorage), so there is no database to set up. All personas share one browser in the demo.
- The re-plan logic is a transparent heuristic, not a black box: it only adds a crew within the limits (1 extra crew/day, no overtime) and only pulls forward tasks whose predecessors are finished and whose readiness is fully cleared.
- Notices are filled from recorded fields only; anything missing appears as a visible `[placeholder]`.

## Next steps

1. Shared database (e.g. Vercel Postgres / Supabase) + login and roles, so every foreman uses their own phone.
2. Real notifications (push / email).
3. Whisper (open source) for speech-to-text, offline capture.
4. WhatsApp Business API (send and read replies), native .mpp import, contract parsing; claims evidence pack for the claims manager.
5. Constraint solver (OR-Tools) for larger plans; templates reviewed by a construction lawyer.
