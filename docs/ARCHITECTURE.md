# Cats Track – prototype architecture

What runs today at [hack-tumai-construction.vercel.app](https://hack-tumai-construction.vercel.app) (Tum.ai Construction Hack, Challenge B).
The plan logic runs in the browser; only the language work goes to the server, which calls open-source models.
Synthetic demo data, no login, no database: each browser keeps its own state.

![Cats Track on Vercel: deployment architecture](diagram/architecture.svg)

The diagrams below show the same system in more detail. They are written in Mermaid, so GitHub draws them from the text.

## 1. System overview

```mermaid
flowchart TB
  subgraph USERS["People on site"]
    direction LR
    SM["Site manager<br/>phone or laptop"]
    FM["Foremen<br/>demo personas"]
  end

  subgraph BROWSER["Browser: Cats Track app (public/app)"]
    direction LR
    BAPI["Browser APIs<br/>Web Speech DE/EN<br/>camera · print to PDF"]
    UI["Screens · app.js<br/>Today · Record · Plan<br/>Needs you · Library"]
    STORE[("localStorage<br/>tasks · logs · decisions<br/>notices · messages")]
    ENG["Plan engine · engine.js<br/>schedule · knock-on effects<br/>5-day scan · re-plan"]
    RULES["Rules fallback<br/>engine.js"]
    TPL["Templates · engine.js<br/>VOB/B letters · daily report<br/>message texts"]
    SEED["Seed · data.js<br/>project · teams · 14 tasks"]
    BAPI --- UI
    UI <--> STORE
    SEED --> STORE
    UI <--> ENG
    ENG --> TPL
    UI -. "no usable AI answer" .-> RULES
  end

  subgraph VERCEL["Vercel: Next.js 16 (/ serves the app)"]
    direction LR
    API["API routes<br/>/api/extract · /api/vision<br/>/api/minutes · /api/summary"]
    AI["AI client · src/lib/ai.ts<br/>JSON mode · model fallback<br/>output checked against tasks"]
    API --> AI
  end

  subgraph MODELS["Model providers (OpenAI-compatible API)"]
    direction LR
    GROQ["Groq<br/>Qwen3 · text and photos"]
    OPT["Optional<br/>Ollama local · Claude"]
  end

  OUT["WhatsApp · SMS · email<br/>wa.me · sms: · mailto: links"]

  USERS --> UI
  UI <-- "note, photo, minutes ⇄ structured log (JSON)" --> API
  AI --> GROQ
  AI -.-> OPT
  TPL --> OUT
```

**Why this split:** the schedule logic is deterministic and small, so it runs instantly in the browser and works even when no model is reachable. The API key stays on the server. Every model answer is checked against the real task list and contacts before the app uses it.

## 2. One note, end to end

```mermaid
sequenceDiagram
  autonumber
  actor F as Foreman
  participant App as Cats Track app (browser)
  participant API as /api/extract (Vercel)
  participant LLM as Qwen3 on Groq
  participant Eng as Plan engine (browser)
  actor SM as Site manager

  F->>App: Voice note (Web Speech API):<br/>"Bagger steht seit 10 Uhr in Abschnitt C …"
  App->>API: text + open tasks + today
  API->>LLM: grounded prompt (tasks, contacts), JSON mode
  LLM-->>API: type, task, cause, location, next steps
  API-->>App: sanitised log (unknown tasks and contacts dropped)
  Note over App: If the call fails: rules in engine.js build the same log
  App->>F: One follow-up question ("How long?")
  F->>App: Answer + Save
  App->>Eng: stoppage on task E1, +1 day
  Eng-->>App: knock-on effect, milestone slips, re-plan proposal
  App->>SM: "Needs you": approve re-plan
  SM->>App: Approve
  App->>Eng: apply re-plan (extra crew, pull work forward)
  App->>SM: Updates to send (action / FYI) + VOB/B § 6 notice draft
  SM->>App: Send via WhatsApp, SMS or email · approve letter · print PDF
```

## 3. Plan engine

```mermaid
flowchart TB
  T["Tasks<br/>id, team, section, start, duration,<br/>crew, predecessors, readiness, milestone"]
  T --> TOPO["topoOrder<br/>dependency order"]
  TOPO --> SCH["schedule<br/>forward pass over working days<br/>(earliest start / finish)"]
  SCH --> MS["milestoneSlips<br/>days late per milestone"]
  SCH --> IMP["computeImpact<br/>which tasks and people a change touches"]
  SCH --> PREV["preventiveScan<br/>missing drawings, material, crane slots<br/>in the next 5 working days"]
  SCH --> REP["proposeReplan<br/>+1 crew within limits,<br/>pull unblocked work forward"]
  IMP --> MSG["changeMessages<br/>action vs FYI per affected contact"]
  PREV --> REQ["draftAnforderung<br/>document request letter"]
  REP --> NOTICE["draftBehinderung<br/>VOB/B § 6 obstruction notice"]
```

## 4. Main data objects (browser state)

```mermaid
classDiagram
  class Task {
    id, name, team, section
    plannedStart, duration, crew
    predecessors[], milestone
    status, delayDays, readiness
  }
  class Log {
    id, createdAt, author, type
    transcript, summary, fields
    location, state, photos[]
    source: voice|text|photo|minutes
    engine: open|claude|rules
  }
  class NextStep {
    kind: task|notify|contact|remind
    text, who, dueDay
  }
  class Proposal {
    taskId, days, mode: shift|extend
    status: pending|accepted|rejected
  }
  class Message {
    to, subject, body
    purpose: action|fyi
    status: draft|sent, channel
  }
  class Notice {
    kind: VOB/B letter or daily report
    text, status: draft|approved
  }
  class Decision {
    kind: preventive|reactive|change
    text, by, day
  }
  class Contact {
    name, role, company
    phone, email, usesApp
  }
  Log "1" --> "*" NextStep
  Log --> Task : about
  Log --> Proposal : reported delay
  NextStep --> Contact : who
  Message --> Contact : to
  Proposal --> Task
  Notice --> Log : drafted from
  Decision --> Task
```

## 5. Where things live

| Path | What it is |
| --- | --- |
| `public/app/index.html` | Entry page of the live app (Tailwind via CDN) |
| `public/app/app.js` | All screens, state, actions; calls the API routes |
| `public/app/engine.js` | Plan engine, rule-based note and minutes parsing, VOB/B and report templates, message texts |
| `public/app/data.js` | Seed project: Wohnanlage Lindenhof, Haus 2 – teams, tasks, contacts, sample notes |
| `src/app/api/extract` | Note → structured log (open model, Claude, or rules) |
| `src/app/api/vision` | Photo → caption, findings, text in the image |
| `src/app/api/minutes` | Meeting minutes → one log per agenda item |
| `src/app/api/summary` | "Today so far" summary from the day's facts |
| `src/app/api/status` | Which engine and models are active (`?check=1` asks the provider) |
| `src/lib/ai.ts` | OpenAI-compatible client: JSON parsing, model fallback, Groq-specific settings |
| `src/app/classic` | Earlier React UI, still reachable at `/classic` |
| `public/landing`, `public/platform.html` | Landing page, platform documentation |

## 6. Configuration

| Variable | Purpose |
| --- | --- |
| `LLM_BASE_URL` | OpenAI-compatible endpoint, e.g. `https://api.groq.com/openai/v1` or a local Ollama |
| `LLM_API_KEY` | Provider key (server only, never sent to the browser) |
| `LLM_MODEL`, `VLM_MODEL` | Text and vision model; if one is not available, the client falls back to the other |
| `ANTHROPIC_API_KEY` | Optional: Claude instead of an open model |

Without any key, every feature still works with the built-in rules.

## Limits of the prototype

- No login or shared database: state lives in each browser's localStorage, so team members don't see each other's changes.
- Messages open WhatsApp, SMS or email with the text filled in; the app does not send them or read replies.
- PDF export uses the browser's print dialog.
- Drafted letters are a drafting aid, not legal advice; the site manager reviews and approves them.
