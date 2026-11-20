# SiteFlow – AI site assistant (Tum.ai Construction Hack, Challenge B)

One shared two-week plan for the whole site. Every subcontractor updates their own tasks by voice from the site.
The assistant **flags blockers before they bite** (preventive), **proposes a re-plan when something breaks** (reactive),
and **drafts every notice and report** (VOB/B). The site manager approves re-plans and outgoing documents.

> Prototype with synthetic data. Drafts are a drafting aid, not legal advice.

📄 **Platform explanation:** [`public/platform.html`](public/platform.html), live at [hack-tumai-construction.vercel.app/platform.html](https://hack-tumai-construction.vercel.app/platform.html). Keep it updated with every change (see its changelog section).

## What the MVP does

| Area | What works |
| --- | --- |
| Capture | Voice dictation in German or English (browser speech API, Chrome/Edge/Safari), typing, photos, demo phrases |
| Extraction | Note → structured diary entry (type, task, cause, responsible party, time, delay). Claude if `ANTHROPIC_API_KEY` is set, otherwise a rule-based fallback. Asks one follow-up question for missing facts. |
| Shared plan | Two-week Gantt for 4 subcontractor teams, readiness checklists, milestones, forward-pass scheduling |
| Change control | Foremen change their own tasks freely; impact on other teams and milestones is computed and the affected people are notified |
| Preventive | Daily scan of tasks starting in the next 5 working days, top 3 blockers ranked by due date and milestone criticality, draft request letters, mark cleared |
| Reactive | Stoppage → knock-on effect → re-plan proposal (add crew to recover milestone slip, pull unblocked work forward to avoid idle crews), explained in plain words, approve/reject |
| Documents | VOB/B drafts: Behinderungsanzeige (§ 6 Abs. 1), Mängelanzeige (§ 4 Abs. 7) / Mängelrüge, Mehrkostenanzeige (§ 2 Abs. 5/6), Bedenkenanzeige (§ 4 Abs. 3), Anforderung von Unterlagen (§ 3 Abs. 1), daily report. Edit, approve, export PDF and Word. |
| Audit trail | Site diary, decision log (preventive / reactive / change), change log with who was notified |
| KPIs | Preventive vs reactive decisions today, milestone status |

## Demo script (≈ 5 min)

1. **07:00 – Preventive.** As *Max Bauer (site manager)*, look at “Blockers to clear”: crane double-booked, slab drawings missing from the client, steel for section C unconfirmed. Click **Draft request** on the drawings → review in Documents → Approve.
2. **10:00 – Reactive.** Click demo phrase **Excavator idle (DE)** → *Structure note* → answer “1 day” → *Save*.
3. **Re-plan.** See the proposal: without action the foundation milestone slips 1 day; with the re-plan it holds and ≈72 idle crew-hours are avoided. **Approve**.
4. **Notice.** *Draft obstruction notice* → edit → **Approve** → **PDF / Word**.
5. **11:00 – Change control.** Switch to *Lena Weber (formwork)* → My tasks → *Formwork slab floor 2 A* → +1 day → reason → *Apply*. Switch to *Mehmet Kaya (rebar)*: he is notified, and the milestone warning shows.
6. **17:00 – Report.** Back as site manager → Documents → **+ Daily report** → export.

Use **Reset demo** in the header to start again.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
npm run check:engine # prints the plan engine's results for the demo scenario
```

Optional: copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY` to use Claude for extraction.

## Deploy to Vercel

1. Import this GitHub repo in Vercel (framework preset: Next.js, no settings needed).
2. Optional: add `ANTHROPIC_API_KEY` (and `ANTHROPIC_MODEL`) under *Settings → Environment Variables*.
3. Deploy. Voice input needs HTTPS, which Vercel provides.

## Architecture

```
src/
  app/
    page.tsx              UI shell: persona switch, tabs
    api/extract/route.ts  note → structured entry (Claude tool-use, rule fallback)
    api/status/route.ts   which AI engine is active
  components/             Today, Capture, Replan, Plan (Gantt), TaskEditor, Diary, Documents
  lib/
    seed.ts               synthetic site: teams, personas, 14 tasks, milestones, settings
    engine.ts             scheduling, impact, preventive scan, re-plan heuristic
    extract-rules.ts      offline keyword extractor (DE/EN)
    templates.ts          VOB/B notice and daily report templates
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
3. Whisper for speech-to-text, offline capture.
4. Plan import from Excel / MS Project; claims evidence pack for the claims manager.
5. Constraint solver (OR-Tools) for larger plans; templates reviewed by a construction lawyer.
