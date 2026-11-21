// POST /api/extract
// Turns a dictated or typed site note (plus optional photo descriptions) into a structured diary entry.
// Engine priority: open-source model (LLM_BASE_URL) → Claude (ANTHROPIC_API_KEY) → rule-based fallback.

import { aiConfig, openChatJsonWithFallback, shortReason } from "@/lib/ai";
import { extractWithRules, locationFromText, overrideFromText, suggestSteps, type DraftStep, type ExtractResult, type ExtractTask } from "@/lib/extract-rules";
import { CONTACTS } from "@/lib/seed";
import type { EntryType, TeamId } from "@/lib/types";

const ENTRY_TYPES: EntryType[] = ["stoppage", "delivery", "defect", "incident", "meeting", "attendance", "progress", "instruction", "note"];

const RULES = `You structure notes from German construction sites into site diary entries.
Rules:
- Use ONLY facts stated in the note or visible in the photo descriptions. Never invent times, amounts, parties or causes.
- If a required fact is missing, leave the field empty and list its key in "missing".
- Required: stoppage → taskId, cause, responsibleParty, estimatedDelayDays. defect → taskId, location, responsibleParty. delivery → material, quantity.
- Pick taskId only from the given task list; if unsure, leave it empty.
- "summary" is one short English sentence. Keep German terms in brackets if useful.
- "followUpQuestion": ONE short question asking for the most important missing fact, in the language of the note. Empty if nothing is missing.
- startTime as HH:MM (24h).
- Unified log format: "location" (building, floor, room, section as spoken; empty if not said), "state" (the current state in one short sentence), "nextSteps" (what should happen next).
- nextSteps: each {"kind": task|notify|contact|remind|other, "text": short action, "who": a contact id from the directory, "dueInDays": working days from today or null, "source": "user" if the speaker said it, else "ai"}.
- If the speaker says what should (or should not) happen, use exactly that and mark it "user"; do not add your own steps then. Example: "erst in drei Monaten erneut ansprechen" → one remind step in about 63 working days.
- Otherwise propose 1–3 sensible steps: who must fix it (task), who must be informed (notify/contact). Never invent people outside the directory.
- Ask for the location in followUpQuestion if a problem is reported without one.`;

const JSON_SPEC = `Return ONLY a JSON object:
{"type": one of ${ENTRY_TYPES.join("|")},
 "summary": string,
 "fields": {"taskId"?: string, "cause"?: string, "responsibleParty"?: string, "startTime"?: "HH:MM", "estimatedDelayDays"?: number, "material"?: string, "quantity"?: string, "location"?: string, "severity"?: string, "participants"?: string, "decisions"?: string, "openItems"?: string},
 "missing": string[],
 "followUpQuestion": string,
 "location": string,
 "state": string,
 "nextSteps": [{"kind": "task|notify|contact|remind|other", "text": string, "who": string, "dueInDays": number|null, "source": "user|ai"}]}`;

const KINDS_LIST = ["task", "notify", "contact", "remind", "other"];
const TOOL = {
  name: "record_entry",
  description: "Record one structured site diary entry.",
  input_schema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ENTRY_TYPES },
      summary: { type: "string" },
      fields: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          cause: { type: "string" },
          responsibleParty: { type: "string" },
          startTime: { type: "string" },
          estimatedDelayDays: { type: "number" },
          material: { type: "string" },
          quantity: { type: "string" },
          location: { type: "string" },
          severity: { type: "string" },
          participants: { type: "string" },
          decisions: { type: "string" },
          openItems: { type: "string" },
        },
      },
      missing: { type: "array", items: { type: "string" } },
      followUpQuestion: { type: "string" },
      location: { type: "string" },
      state: { type: "string" },
      nextSteps: {
        type: "array",
        items: {
          type: "object",
          properties: { kind: { type: "string", enum: KINDS_LIST }, text: { type: "string" }, who: { type: "string" }, dueInDays: { type: "number" }, source: { type: "string", enum: ["user", "ai"] } },
          required: ["kind", "text"],
        },
      },
    },
    required: ["type", "summary", "fields", "missing"],
  },
};

interface Body {
  today?: number;
  text: string;
  tasks: ExtractTask[];
  personaTeam?: TeamId;
  speaker?: string;
  photoNotes?: string[];
}

function userPrompt(b: Body, text: string) {
  const photos = (b.photoNotes ?? []).filter(Boolean);
  return `Today is working day ${b.today ?? 0}.
Directory (contact id | name | role | company):
${CONTACTS.map((c) => `${c.id} | ${c.name} | ${c.role} | ${c.company}`).join("\n")}

Speaker: ${b.speaker ?? "unknown"} (team: ${b.personaTeam ?? "site management"})
Tasks in the two-week plan (id | name | section | team):
${(b.tasks ?? []).map((t) => `${t.id} | ${t.name} | ${t.section} | ${t.team}`).join("\n")}

Note:
"""${text}"""${photos.length ? `\n\nPhoto descriptions (from a vision model):\n${photos.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : ""}`;
}

/** Keep only known types/fields and drop empty values, whatever the model returned. */
type RawStep = { kind?: string; text?: string; who?: string; dueInDays?: number | null; source?: string };
const KINDS = ["task", "notify", "contact", "remind", "other"];

function sanitizeSteps(raw: unknown, today: number): DraftStep[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawStep[])
    .filter((st) => st && KINDS.includes(String(st.kind)) && st.text)
    .slice(0, 5)
    .map((st) => ({
      kind: st.kind as DraftStep["kind"],
      text: String(st.text).slice(0, 200),
      who: CONTACTS.some((c) => c.id === st.who) ? String(st.who) : undefined,
      dueDay: Number.isFinite(Number(st.dueInDays)) && st.dueInDays !== null ? today + Math.max(0, Math.round(Number(st.dueInDays))) : undefined,
      source: st.source === "user" ? "user" : "ai",
    }));
}

function sanitize(raw: Partial<ExtractResult> & { nextSteps?: unknown }, tasks: ExtractTask[], engine: ExtractResult["engine"], text = "", today = 0): ExtractResult {
  const type = ENTRY_TYPES.includes(raw.type as EntryType) ? (raw.type as EntryType) : "note";
  const fields: ExtractResult["fields"] = {};
  for (const [k, v] of Object.entries(raw.fields ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    if (k === "estimatedDelayDays") {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) fields[k] = n;
    } else fields[k] = String(v);
  }
  if (fields.taskId && !tasks.some((t) => t.id === fields.taskId)) delete fields.taskId;
  const missing = (Array.isArray(raw.missing) ? raw.missing.map(String) : []).filter((m) => fields[m] === undefined);
  // A stated override ("in drei Monaten erneut ansprechen") always wins, whatever the model returned.
  const override = overrideFromText(text, today);
  let nextSteps = sanitizeSteps(raw.nextSteps, today);
  if (override.suppressAi) nextSteps = override.steps.length ? override.steps : nextSteps.filter((st) => st.source === "user");
  else if (!nextSteps.length) {
    const task = tasks.find((t) => t.id === fields.taskId);
    nextSteps = suggestSteps(type, text, fields, task, today);
  }
  return {
    type,
    summary: String(raw.summary ?? "").trim() || "Site note",
    fields,
    missing,
    followUpQuestion: missing.length ? String(raw.followUpQuestion ?? "").trim() || undefined : undefined,
    engine,
    location: String(raw.location ?? "").trim() || locationFromText(text),
    state: String(raw.state ?? "").trim() || undefined,
    nextSteps,
  };
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const photoText = (body.photoNotes ?? []).filter(Boolean).join(" ");
  const text = (body.text ?? "").trim() || photoText; // a photo alone can start a note
  if (!text) return Response.json({ error: "empty note" }, { status: 400 });
  const tasks = body.tasks ?? [];
  const cfg = aiConfig();

  try {
    if (cfg.engine === "open") {
      // If the text model is not available for this key, the vision model (also an LLM) takes over.
      const { out: raw, model } = await openChatJsonWithFallback<Partial<ExtractResult>>(cfg, [cfg.textModel!, cfg.visionModel!], [
        { role: "system", content: `${RULES}\n\n${JSON_SPEC}` },
        { role: "user", content: userPrompt(body, text) },
      ]);
      return Response.json({ ...sanitize(raw, tasks, "open", text, body.today ?? 0), model });
    }

    if (cfg.engine === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: cfg.textModel,
          max_tokens: 800,
          system: RULES,
          tools: [TOOL],
          tool_choice: { type: "tool", name: TOOL.name },
          messages: [{ role: "user", content: userPrompt(body, text) }],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const block = (data.content ?? []).find((c: { type: string }) => c.type === "tool_use");
      if (!block) throw new Error("no tool_use block");
      return Response.json({ ...sanitize(block.input, tasks, "claude", text, body.today ?? 0), model: cfg.textModel });
    }
  } catch (err) {
    console.error(`extract: ${cfg.engine} failed, falling back to rules`, err);
    return Response.json({ ...extractWithRules(text, tasks, body.personaTeam, body.today ?? 0), fallbackReason: shortReason(err) });
  }
  return Response.json(extractWithRules(text, tasks, body.personaTeam, body.today ?? 0));
}
