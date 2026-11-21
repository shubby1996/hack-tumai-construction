// Meeting minutes → one log per agenda item, each with its next step (who, what, by when).
// Used as the rule-based fallback and to clean up whatever a model returns.

import { extractWithRules, locationFromText, whoFromText, type DraftStep, type ExtractTask } from "./extract-rules";
import { PROJECT } from "./seed";
import type { EntryType } from "./types";

export interface MinutesItem {
  text: string; // the original line
  type: EntryType;
  summary: string;
  location?: string;
  state: string;
  taskId?: string;
  nextSteps: DraftStep[];
}

const WEEKDAYS: [number, string[]][] = [
  [0, ["montag", "monday"]],
  [1, ["dienstag", "tuesday"]],
  [2, ["mittwoch", "wednesday"]],
  [3, ["donnerstag", "thursday"]],
  [4, ["freitag", "friday"]],
];

/** "bis Donnerstag", "ab Mittwoch", "01.12.2026" → working-day index (day 0 = plan start, a Monday). */
export function dueFromText(raw: string, today: number): number | undefined {
  const t = raw.toLowerCase();
  const date = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})?/);
  if (date) {
    const start = new Date(`${PROJECT.planStart}T12:00:00Z`);
    const d = new Date(Date.UTC(Number(date[3] ?? start.getUTCFullYear()), Number(date[2]) - 1, Number(date[1]), 12));
    let n = 0;
    const cur = new Date(start);
    if (d < start) return undefined;
    while (cur < d) {
      cur.setUTCDate(cur.getUTCDate() + 1);
      const wd = cur.getUTCDay();
      if (wd !== 0 && wd !== 6) n++;
    }
    return n;
  }
  const wd = WEEKDAYS.find(([, w]) => w.some((x) => t.includes(x)))?.[0];
  if (wd === undefined) return undefined;
  for (let d = today; d < today + 10; d++) if (d % 5 === wd) return d;
  return undefined;
}

/** Split minutes into agenda items: numbered lines, bullets, or plain lines. Header lines are dropped. */
export function splitMinutes(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const items = lines.filter((l) => /^(\d+[.)]|[-•*–])\s+/.test(l));
  const chosen = items.length ? items : lines.filter((l) => !/(teilnehmer|participants|protokoll|^baubesprechung)/i.test(l));
  return chosen.map((l) => l.replace(/^(\d+[.)]|[-•*–])\s+/, "").trim()).filter((l) => l.length > 3);
}

export function minutesWithRules(raw: string, tasks: ExtractTask[], today: number): MinutesItem[] {
  return splitMinutes(raw).map((line) => {
    const r = extractWithRules(line, tasks, undefined, today);
    const due = dueFromText(line, today);
    const isNextMeeting = /(nächste|next)\s+(bau)?besprechung|next meeting/i.test(line);
    // "Bauleitung stimmt mit Weber ab": the site manager acts, Weber is only involved.
    const who = /(bauleitung|hauptbau|herr bauer)\s+(stimmt|klärt|prüft|kümmert|organisiert|informiert|lädt)/i.test(line) ? "site-manager" : (whoFromText(line) ?? (/(bauleitung|hauptbau)/i.test(line) ? "site-manager" : undefined));
    const step: DraftStep = isNextMeeting
      ? { kind: "remind", text: line, who: "site-manager", dueDay: due, source: "user" }
      : { kind: "task", text: line.replace(/\.$/, ""), who: who ?? "site-manager", dueDay: due, source: "user" };
    return {
      text: line,
      type: isNextMeeting ? "meeting" : r.type === "note" ? "meeting" : r.type,
      summary: line.length > 110 ? `${line.slice(0, 107)}…` : line,
      location: locationFromText(line) ?? r.location,
      state: `Agreed in the site meeting: ${line}`,
      taskId: r.fields.taskId,
      nextSteps: [step],
    };
  });
}
