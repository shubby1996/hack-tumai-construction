// Rule-based fallback extractor (German + English keywords).
// Used when no LLM key is configured, so the demo always works offline.

import type { EntryFields, EntryType, TeamId } from "./types";

export interface ExtractTask {
  id: string;
  name: string;
  team: TeamId;
  section: string;
}

export interface ExtractResult {
  type: EntryType;
  summary: string;
  fields: EntryFields;
  missing: string[];
  followUpQuestion?: string;
  engine: "open" | "claude" | "rules";
  model?: string;
}

const has = (text: string, words: string[]) => words.some((w) => text.includes(w));

const TYPE_RULES: [EntryType, string[]][] = [
  ["stoppage", ["steht", "stillstand", "idle", "blockiert", "blocked", "stopped", "gestoppt", "kann nicht", "cannot", "can't", "behinder", "warten auf", "waiting for"]],
  ["defect", ["riss", "mangel", "mängel", "nacharbeit", "defect", "crack", "rework", "beschädig", "damage", "undicht", "leak"]],
  ["delivery", ["lieferung", "geliefert", "delivery", "delivered", "angekommen", "arrived", "lkw", "truck"]],
  ["incident", ["unfall", "verletz", "accident", "injur", "beinahe", "near miss", "erste hilfe"]],
  ["meeting", ["besprechung", "meeting", "protokoll", "baubesprechung", "jour fixe", "minutes"]],
  ["instruction", ["anordnung", "angewiesen", "instruct", "bauherr will", "client wants", "änderung", "zusätzlich", "additional work"]],
  ["attendance", ["mann vor ort", "leute vor ort", "workers on site", "anwesend", "headcount", "attendance"]],
  ["progress", ["fertig", "erledigt", "abgeschlossen", "done", "finished", "completed", "begonnen", "started", "% "]],
];

const TEAM_WORDS: [TeamId, string[]][] = [
  ["earthworks", ["bagger", "aushub", "excavat", "erdbau", "verfüll", "backfill", "schotter", "gravel"]],
  ["formwork", ["schalung", "formwork", "geschalt"]],
  ["rebar", ["bewehrung", "stahl", "rebar", "eisen", "steel"]],
  ["concrete", ["beton", "betonage", "pour", "concrete", "gießen"]],
];

const RESPONSIBLE_RULES: [string, string[]][] = [
  ["Client (Bauherr)", ["bauherr", "client", "leitungsplan", "planunterlagen", "pläne fehlen", "drawings missing", "utility plan", "auftraggeber"]],
  ["Supplier", ["lieferant", "supplier", "falscher durchmesser", "wrong diameter", "lieferung"]],
  ["Weather", ["regen", "frost", "sturm", "wind", "rain", "storm", "snow", "schnee"]],
];

export function extractWithRules(raw: string, tasks: ExtractTask[], personaTeam?: TeamId): ExtractResult {
  const text = raw.toLowerCase();
  const type: EntryType = TYPE_RULES.find(([, words]) => has(text, words))?.[0] ?? "note";

  // Team: explicit trade words win, otherwise the speaker's own team.
  const team = TEAM_WORDS.find(([, words]) => has(text, words))?.[0] ?? personaTeam;
  const sectionMatch = text.match(/(?:abschnitt|section|bauteil)\s+([a-z])\b/);
  const section = sectionMatch?.[1]?.toUpperCase();

  let candidates = tasks.filter((t) => (team ? t.team === team : true));
  if (section) {
    const s = candidates.filter((t) => t.section === section);
    if (s.length) candidates = s;
  }
  // Prefer wall/slab/foundation hints.
  const hint = [
    ["wand", "wall"],
    ["decke", "slab"],
    ["fundament", "foundation"],
  ].find((pair) => has(text, pair));
  if (hint) {
    const h = candidates.filter((t) => has(t.name.toLowerCase(), [hint[1]]));
    if (h.length) candidates = h;
  }
  const task = candidates[0];

  const fields: EntryFields = {};
  if (task) fields.taskId = task.id;

  const time = text.match(/(?:seit|since|ab|from|um|at)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr|am|pm|h)?/);
  if (time) {
    let h = parseInt(time[1], 10);
    if (/pm/.test(time[0]) && h < 12) h += 12;
    fields.startTime = `${String(h).padStart(2, "0")}:${time[2] ?? "00"}`;
  }

  const causeMatch = raw.match(/(?:weil|wegen|da |because|due to|,)\s*(.+)$/i);
  if (type === "stoppage" || type === "defect" || type === "delivery") {
    fields.cause = causeMatch ? causeMatch[1].trim().replace(/\.$/, "") : undefined;
  }
  const responsible = RESPONSIBLE_RULES.find(([, words]) => has(text, words))?.[0];
  if (responsible) fields.responsibleParty = responsible;
  if (type === "defect") {
    const sub = text.match(/(?:durch|by)\s+([a-zäöüß]+\s+[a-zäöüß]+)/);
    if (sub) fields.responsibleParty = sub[1].replace(/\b\w/g, (c) => c.toUpperCase());
    fields.location = section ? `Section ${section}` : undefined;
  }
  if (type === "delivery") {
    const qty = raw.match(/(\d+[.,]?\d*)\s*(t|tonnen|tons|m³|m3|stück|pcs)/i);
    if (qty) fields.quantity = qty[0];
    fields.material = has(text, ["stahl", "steel", "bewehrung"]) ? "Rebar steel" : has(text, ["beton", "concrete"]) ? "Concrete" : undefined;
  }

  const missing: string[] = [];
  if (type === "stoppage") {
    if (!fields.responsibleParty) missing.push("responsibleParty");
    missing.push("estimatedDelayDays"); // always confirm the expected delay
  }
  if (!fields.taskId && type !== "meeting" && type !== "note") missing.push("taskId");

  const followUpQuestion =
    type === "stoppage"
      ? !fields.responsibleParty
        ? "Who is responsible for the stoppage, and how long will it last?"
        : "How long do you expect the stoppage to last?"
      : missing.includes("taskId")
        ? "Which task does this concern?"
        : undefined;

  const summary = buildSummary(type, raw, task);
  return { type, summary, fields, missing, followUpQuestion, engine: "rules" };
}

function buildSummary(type: EntryType, raw: string, task?: ExtractTask) {
  const label: Record<EntryType, string> = {
    stoppage: "Stoppage",
    delivery: "Delivery",
    defect: "Defect",
    incident: "Incident",
    meeting: "Meeting",
    attendance: "Attendance",
    progress: "Progress",
    instruction: "Instruction",
    note: "Note",
  };
  const where = task ? ` – ${task.name} ${task.section}` : "";
  const clean = raw.trim().replace(/\s+/g, " ");
  return `${label[type]}${where}: ${clean.length > 120 ? clean.slice(0, 117) + "…" : clean}`;
}
