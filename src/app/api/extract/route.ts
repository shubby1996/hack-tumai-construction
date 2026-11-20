// POST /api/extract
// Turns a dictated or typed site note (plus optional photo descriptions) into a structured diary entry.
// Engine priority: open-source model (LLM_BASE_URL) → Claude (ANTHROPIC_API_KEY) → rule-based fallback.

import { aiConfig, openChatJsonWithFallback, shortReason } from "@/lib/ai";
import { extractWithRules, type ExtractResult, type ExtractTask } from "@/lib/extract-rules";
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
- startTime as HH:MM (24h).`;

const JSON_SPEC = `Return ONLY a JSON object:
{"type": one of ${ENTRY_TYPES.join("|")},
 "summary": string,
 "fields": {"taskId"?: string, "cause"?: string, "responsibleParty"?: string, "startTime"?: "HH:MM", "estimatedDelayDays"?: number, "material"?: string, "quantity"?: string, "location"?: string, "severity"?: string, "participants"?: string, "decisions"?: string, "openItems"?: string},
 "missing": string[],
 "followUpQuestion": string}`;

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
    },
    required: ["type", "summary", "fields", "missing"],
  },
};

interface Body {
  text: string;
  tasks: ExtractTask[];
  personaTeam?: TeamId;
  speaker?: string;
  photoNotes?: string[];
}

function userPrompt(b: Body, text: string) {
  const photos = (b.photoNotes ?? []).filter(Boolean);
  return `Speaker: ${b.speaker ?? "unknown"} (team: ${b.personaTeam ?? "site management"})
Tasks in the two-week plan (id | name | section | team):
${(b.tasks ?? []).map((t) => `${t.id} | ${t.name} | ${t.section} | ${t.team}`).join("\n")}

Note:
"""${text}"""${photos.length ? `\n\nPhoto descriptions (from a vision model):\n${photos.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : ""}`;
}

/** Keep only known types/fields and drop empty values, whatever the model returned. */
function sanitize(raw: Partial<ExtractResult>, tasks: ExtractTask[], engine: ExtractResult["engine"]): ExtractResult {
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
  return {
    type,
    summary: String(raw.summary ?? "").trim() || "Site note",
    fields,
    missing,
    followUpQuestion: missing.length ? String(raw.followUpQuestion ?? "").trim() || undefined : undefined,
    engine,
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
      return Response.json({ ...sanitize(raw, tasks, "open"), model });
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
      return Response.json({ ...sanitize(block.input, tasks, "claude"), model: cfg.textModel });
    }
  } catch (err) {
    console.error(`extract: ${cfg.engine} failed, falling back to rules`, err);
    return Response.json({ ...extractWithRules(text, tasks, body.personaTeam), fallbackReason: shortReason(err) });
  }
  return Response.json(extractWithRules(text, tasks, body.personaTeam));
}
