// POST /api/extract
// Turns a dictated or typed site note into a structured diary entry.
// Uses Claude when ANTHROPIC_API_KEY is set; otherwise the rule-based fallback.

import { extractWithRules, type ExtractResult, type ExtractTask } from "@/lib/extract-rules";
import type { TeamId } from "@/lib/types";

const ENTRY_TYPES = ["stoppage", "delivery", "defect", "incident", "meeting", "attendance", "progress", "instruction", "note"];

const SYSTEM = `You structure notes from German construction sites into site diary entries.
Rules:
- Use ONLY facts stated in the note. Never invent times, amounts, parties or causes.
- If a required fact is missing, leave the field empty and list it in "missing".
- Required: stoppage → taskId, cause, responsibleParty, estimatedDelayDays. defect → taskId, location, responsibleParty. delivery → material, quantity.
- Pick taskId only from the given task list; if unsure, leave it empty.
- "summary" is one short English sentence. Keep German terms in brackets if useful.
- "followUpQuestion": ONE short question asking for the most important missing fact, in the language of the note. Empty if nothing is missing.
- startTime as HH:MM (24h).`;

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

export async function POST(req: Request) {
  const body = (await req.json()) as { text: string; tasks: ExtractTask[]; personaTeam?: TeamId; speaker?: string };
  const text = (body.text ?? "").trim();
  if (!text) return Response.json({ error: "empty note" }, { status: 400 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json(extractWithRules(text, body.tasks ?? [], body.personaTeam));

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 800,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [
          {
            role: "user",
            content: `Speaker: ${body.speaker ?? "unknown"} (team: ${body.personaTeam ?? "site management"})
Tasks in the two-week plan (id | name | section | team):
${(body.tasks ?? []).map((t) => `${t.id} | ${t.name} | ${t.section} | ${t.team}`).join("\n")}

Note:
"""${text}"""`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const block = (data.content ?? []).find((c: { type: string }) => c.type === "tool_use");
    if (!block) throw new Error("no tool_use block");
    const out = block.input as Omit<ExtractResult, "engine">;
    return Response.json({ ...out, missing: out.missing ?? [], fields: out.fields ?? {}, engine: "claude" } satisfies ExtractResult);
  } catch (err) {
    console.error("extract: falling back to rules", err);
    return Response.json(extractWithRules(text, body.tasks ?? [], body.personaTeam));
  }
}
