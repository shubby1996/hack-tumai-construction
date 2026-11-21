// Rule-based fallback extractor (German + English keywords).
// Used when no LLM key is configured, so the demo always works offline.

import type { EntryFields, EntryType, NextStep, NextStepKind, TeamId } from "./types";

export type DraftStep = Omit<NextStep, "id">;

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
  fallbackReason?: string; // why the AI model was not used
  // unified log format
  location?: string;
  state?: string;
  nextSteps?: DraftStep[];
}

const NUM_WORDS: Record<string, number> = { ein: 1, einen: 1, eine: 1, one: 1, a: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, fünf: 5, five: 5, sechs: 6, six: 6 };
const toNum = (w: string) => (/^\d+$/.test(w) ? parseInt(w, 10) : NUM_WORDS[w.toLowerCase()] ?? NaN);

const WHO_RULES: [string, string[]][] = [
  ["rebar", ["kraus", "bewehrung", "rebar"]],
  ["formwork", ["weber", "schalung", "formwork"]],
  ["earthworks", ["huber", "erdbau", "earthworks", "bagger", "excavat"]],
  ["concrete", ["schmid", "betonbau", "concrete"]],
  ["client", ["bauherr", "client", "auftraggeber", "roth"]],
  ["supplier", ["lieferant", "supplier", "müller", "mueller", "stahlhandel"]],
];
export const whoFromText = (text: string) => WHO_RULES.find(([, w]) => has(text.toLowerCase(), w))?.[0];

/** Location from speech: section, floor, room, basement, stairs. */
export function locationFromText(raw: string): string | undefined {
  const t = raw.toLowerCase();
  const parts: string[] = [];
  const building = t.match(/(?:haus|building|gebäude)\s+([a-z0-9]+)/);
  if (building) parts.push(`Building ${building[1].toUpperCase()}`);
  const sec = t.match(/(?:abschnitt|section|bauteil)\s+([a-z])\b/);
  if (sec) parts.push(`Section ${sec[1].toUpperCase()}`);
  const ordinal: Record<string, string> = { erste: "1", ersten: "1", erstes: "1", first: "1", zweite: "2", zweiten: "2", zweites: "2", second: "2", dritte: "3", dritten: "3", drittes: "3", third: "3" };
  const floorWord = t.match(/(erste[sn]?|zweite[sn]?|dritte[sn]?|first|second|third)\s+(?:og|obergeschoss|etage|stock|floor)/);
  const floorNum = t.match(/(\d)\.?\s*(?:og|obergeschoss|etage|stock|floor)\b/) || t.match(/floor\s+(\d)/);
  if (floorWord) parts.push(`Floor ${ordinal[floorWord[1]] ?? floorWord[1]}`);
  else if (floorNum) parts.push(`Floor ${floorNum[1]}`);
  else if (/\b(eg|erdgeschoss|ground floor)\b/.test(t)) parts.push("Ground floor");
  if (/\b(keller|basement|untergeschoss|ug)\b/.test(t)) parts.push("Basement");
  const room = t.match(/(?:raum|room|zimmer)\s+([a-z0-9.]+)/);
  if (room) parts.push(`Room ${room[1].toUpperCase()}`);
  if (/\b(treppe|stairs|treppenhaus|stairwell)\b/.test(t)) parts.push("Stairs");
  return parts.length ? parts.join(", ") : undefined;
}

/** "kommt 2 Tage später", "3 days late", "zwei Tage Verzug" → 2 */
export function delayFromText(raw: string): number | undefined {
  const m = raw.toLowerCase().match(/(\d+|ein(?:en|e)?|one|zwei|two|drei|three|vier|four|fünf|five)\s+(?:arbeits)?(?:tage?n?|days?)\s+(?:später|spaeter|late|later|verspätet|verzug|delay|verzögerung)/);
  if (!m) return undefined;
  const n = toNum(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** User override: "erst in drei Monaten erneut ansprechen", "remind me in 2 weeks", "nichts tun". */
export function overrideFromText(raw: string, today: number): { steps: DraftStep[]; suppressAi: boolean } {
  const t = raw.toLowerCase();
  const steps: DraftStep[] = [];
  const m = t.match(/(?:in|nach|after)\s+(\d+|ein(?:em|en)?|one|zwei|two|drei|three|vier|four|sechs|six)\s+(monate?n?|months?|wochen?|weeks?|tage?n?|days?)/);
  const wantsReminder = /(erneut|wieder|nochmal|erinner|ansprechen|remind|bring (?:it )?up|follow up|check again)/.test(t);
  if (m && wantsReminder) {
    const n = toNum(m[1]);
    const unit = m[2];
    const days = /mon/.test(unit) ? n * 21 : /woch|week/.test(unit) ? n * 5 : n;
    steps.push({ kind: "remind", text: `Bring this up again (${m[0]})`, who: "site-manager", dueDay: today + days, source: "user" });
  }
  const suppressAi = /(nichts tun|nichts unternehmen|don'?t do anything|do nothing|keine maßnahmen|no action)/.test(t) || steps.length > 0;
  return { steps, suppressAi };
}

const has = (text: string, words: string[]) => words.some((w) => text.includes(w));

const TYPE_RULES: [EntryType, string[]][] = [
  ["stoppage", ["steht", "stillstand", "idle", "blockiert", "blocked", "stopped", "gestoppt", "kann nicht", "cannot", "can't", "behinder", "warten auf", "waiting for"]],
  ["defect", ["riss", "mangel", "mängel", "nacharbeit", "defect", "crack", "rework", "beschädig", "damage", "undicht", "leak", "gebrochen", "broken", "kaputt"]],
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

export function extractWithRules(raw: string, tasks: ExtractTask[], personaTeam?: TeamId, today = 0): ExtractResult {
  const text = raw.toLowerCase();
  const delay = delayFromText(raw);
  let type: EntryType = TYPE_RULES.find(([, words]) => has(text, words))?.[0] ?? "note";
  if (type === "note" && delay) type = "progress"; // a reported delay of planned work

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
  // Only link a task when the note names a trade, a section or the speaker has a team.
  const task = team || section ? candidates[0] : undefined;

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

  if (delay) fields.estimatedDelayDays = delay;
  const location = locationFromText(raw);

  const missing: string[] = [];
  if (!location && ["stoppage", "defect", "delivery", "incident"].includes(type)) missing.push("location");
  if (type === "stoppage") {
    if (!fields.responsibleParty) missing.push("responsibleParty");
    if (!fields.estimatedDelayDays) missing.push("estimatedDelayDays"); // confirm the expected delay
  }
  if (!fields.taskId && type === "stoppage") missing.push("taskId"); // needed for the re-plan

  const followUpQuestion =
    type === "stoppage"
      ? !fields.responsibleParty
        ? "Who is responsible for the stoppage, and how long will it last?"
        : "How long do you expect the stoppage to last?"
      : missing.includes("taskId")
        ? "Which task does this concern?"
        : undefined;

  const summary = buildSummary(type, raw, task);
  const state = raw.trim().replace(/\s+/g, " ").split(/(?<=[.!?])\s/)[0];
  const nextSteps = suggestSteps(type, raw, fields, task, today);
  return {
    type,
    summary,
    fields,
    missing,
    followUpQuestion: followUpQuestion ?? (missing.includes("location") ? "Where exactly is this (building, floor, room or section)?" : undefined),
    engine: "rules",
    location,
    state,
    nextSteps,
  };
}

/** Default next steps (rules). What the speaker says always overrides these. */
export function suggestSteps(type: EntryType, raw: string, fields: EntryFields, task: ExtractTask | undefined, today: number): DraftStep[] {
  const override = overrideFromText(raw, today);
  if (override.suppressAi) return override.steps;
  const teamWho = task?.team as string | undefined;
  const respWho = fields.responsibleParty ? whoFromText(String(fields.responsibleParty)) : undefined;
  const who = respWho ?? whoFromText(raw);
  const s = (kind: NextStepKind, text: string, w?: string, dueDay?: number): DraftStep => ({ kind, text, who: w, dueDay, source: "rules" });
  const steps: DraftStep[] = [];
  const what = task ? `${task.name} ${task.section}` : "the affected work";
  switch (type) {
    case "stoppage":
      // Whoever caused it has to act; the team standing idle only needs to know.
      if (who && who !== teamWho) {
        steps.push(s("contact", `Stoppage on ${what}: ${fields.cause ?? "see log"}. Please help resolve it.`, who));
        if (teamWho) steps.push(s("notify", `${what} is on hold until this is resolved.`, teamWho));
      } else steps.push(s("notify", `Stoppage on ${what}: ${fields.cause ?? "see log"}.`, who ?? teamWho));
      steps.push(s("task", `Resolve stoppage on ${what}`, "site-manager", today));
      if (who === "client") steps.push(s("other", "Check if an obstruction notice (Behinderungsanzeige) is needed", "site-manager", today));
      break;
    case "defect":
      steps.push(s("task", `Repair defect: ${fields.cause ?? raw.slice(0, 60)}`, who ?? teamWho, today + 3));
      steps.push(s("notify", `Defect found on ${what}. Please repair and confirm.`, who ?? teamWho));
      break;
    case "delivery":
      steps.push(s("contact", `Delivery problem: ${fields.cause ?? "see log"}. Please arrange replacement.`, "supplier"));
      steps.push(s("notify", `Delivery for ${what} is affected.`, teamWho));
      break;
    case "incident":
      steps.push(s("task", "Document incident and inform safety officer", "site-manager", today));
      break;
    case "instruction":
      steps.push(s("other", "Check if an additional cost notice (Mehrkostenanzeige) is needed", "site-manager", today));
      break;
    default:
      if (fields.estimatedDelayDays) steps.push(s("task", `Decide on plan change: ${what} +${fields.estimatedDelayDays} day(s)`, "site-manager", today));
  }
  return steps;
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
