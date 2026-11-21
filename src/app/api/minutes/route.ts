// POST /api/minutes – split pasted meeting minutes into log items with next steps.
// Open-source model if configured, otherwise the rule-based splitter.

import { aiConfig, openChatJsonWithFallback, shortReason } from "@/lib/ai";
import type { DraftStep, ExtractTask } from "@/lib/extract-rules";
import { minutesWithRules, type MinutesItem } from "@/lib/minutes";
import { CONTACTS } from "@/lib/seed";
import type { EntryType } from "@/lib/types";

const TYPES: EntryType[] = ["stoppage", "delivery", "defect", "incident", "meeting", "attendance", "progress", "instruction", "note"];
const KINDS = ["task", "notify", "contact", "remind", "other"];

const PROMPT = `You turn German construction site meeting minutes into log items.
Return ONLY JSON: {"items": [{"line": original agenda item text, "type": ${TYPES.join("|")}, "summary": one short English sentence, "location": string or "", "taskId": id from the task list or "", "who": contact id responsible, "kind": task|notify|contact|remind|other, "action": short English action, "dueInDays": working days from today or null}]}
Rules: one item per agenda point; use only facts in the minutes; "who" only from the directory; never invent dates.`;

export async function POST(req: Request) {
  const body = (await req.json()) as { text: string; today?: number; tasks?: ExtractTask[] };
  const text = (body.text ?? "").trim().slice(0, 6000);
  if (!text) return Response.json({ error: "empty minutes" }, { status: 400 });
  const today = body.today ?? 0;
  const tasks = body.tasks ?? [];
  const rules = minutesWithRules(text, tasks, today);
  const cfg = aiConfig();
  if (cfg.engine !== "open") return Response.json({ items: rules, engine: "rules" });
  try {
    const { out, model } = await openChatJsonWithFallback<{ items?: Record<string, unknown>[] }>(cfg, [cfg.textModel!, cfg.visionModel!], [
      { role: "system", content: PROMPT },
      {
        role: "user",
        content: `Today is working day ${today}.\nDirectory (id | name | role):\n${CONTACTS.map((c) => `${c.id} | ${c.name} | ${c.role}`).join("\n")}\nTasks (id | name | section | team):\n${tasks.map((t) => `${t.id} | ${t.name} | ${t.section} | ${t.team}`).join("\n")}\n\nMinutes:\n"""${text}"""`,
      },
    ]);
    const items: MinutesItem[] = (out.items ?? []).slice(0, 15).map((it, i) => {
      const fallback = rules[i];
      const who = CONTACTS.some((c) => c.id === it.who) ? String(it.who) : fallback?.nextSteps[0]?.who;
      const dueIn = Number(it.dueInDays);
      const step: DraftStep = {
        kind: (KINDS.includes(String(it.kind)) ? it.kind : "task") as DraftStep["kind"],
        text: String(it.action || it.line || fallback?.text || "").slice(0, 200),
        who,
        // Dates: trust the rule-based reading of "bis Donnerstag" over the model's arithmetic.
        dueDay: fallback?.nextSteps[0]?.dueDay ?? (Number.isFinite(dueIn) && it.dueInDays !== null ? today + Math.max(0, Math.round(dueIn)) : undefined),
        source: "user",
      };
      const line = String(it.line || fallback?.text || step.text);
      return {
        text: line,
        type: TYPES.includes(it.type as EntryType) ? (it.type as EntryType) : "meeting",
        summary: String(it.summary || line).slice(0, 160),
        location: String(it.location || "") || fallback?.location,
        state: `Agreed in the site meeting: ${line}`,
        taskId: tasks.some((t) => t.id === it.taskId) ? String(it.taskId) : fallback?.taskId,
        nextSteps: [step],
      };
    });
    return Response.json(items.length ? { items, engine: "open", model } : { items: rules, engine: "rules", fallbackReason: "model returned no items" });
  } catch (err) {
    return Response.json({ items: rules, engine: "rules", fallbackReason: shortReason(err) });
  }
}
