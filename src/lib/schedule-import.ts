// Initialise the site plan from a schedule export (MS Project → Excel/CSV, or any Excel sheet).
// Expected columns (German or English headers, any order):
// ID | Name/Vorgang | Team/Gewerk | Section/Abschnitt | Start | Duration/Dauer | Crew/Personal | Predecessors/Vorgänger | Milestone/Meilenstein

import { dayToDate } from "./dates";
import { MILESTONES, PROJECT } from "./seed";
import type { Task, TeamId } from "./types";

type Cell = string | number | boolean | Date | null | undefined;

const COLS: Record<string, string[]> = {
  id: ["id", "nr", "nummer", "vorgangsnr", "task id"],
  name: ["name", "vorgang", "task", "vorgangsname", "bezeichnung", "activity"],
  team: ["team", "gewerk", "trade", "firma", "subcontractor", "nachunternehmer", "resource", "ressource"],
  section: ["section", "abschnitt", "bauteil", "bereich", "area"],
  start: ["start", "anfang", "beginn", "start date", "planned start"],
  duration: ["duration", "dauer", "tage", "days"],
  crew: ["crew", "personal", "arbeitskräfte", "workers", "kolonne"],
  predecessors: ["predecessors", "vorgänger", "vorgaenger", "depends on", "abhängigkeit"],
  milestone: ["milestone", "meilenstein"],
};

const TEAM_WORDS: [TeamId, string[]][] = [
  ["earthworks", ["earth", "erd", "aushub", "tiefbau", "huber"]],
  ["formwork", ["form", "schal", "weber"]],
  ["rebar", ["rebar", "beweh", "stahl", "kraus", "eisen"]],
  ["concrete", ["concrete", "beton", "schmid"]],
];

/** Date → working-day index from the plan start (weekends skipped). */
export function workingDayIndex(d: Date): number {
  const start = new Date(`${PROJECT.planStart}T12:00:00Z`);
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12));
  if (target <= start) return 0;
  let n = 0;
  const cur = new Date(start);
  while (cur < target) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const wd = cur.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

function parseStart(v: Cell): number | undefined {
  if (v instanceof Date) return workingDayIndex(v);
  if (typeof v === "number") return v < 400 ? Math.round(v) : undefined;
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) return workingDayIndex(new Date(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), Number(m[2]) - 1, Number(m[1])));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return workingDayIndex(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const n = Number(s.replace(/[^\d]/g, ""));
  return s && Number.isFinite(n) ? n : undefined;
}

const num = (v: Cell, dflt: number) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

/** Parse CSV (comma or semicolon, quotes allowed) into rows. */
export function parseCsv(text: string): string[][] {
  const delim = (text.split(/\r?\n/)[0].match(/;/g)?.length ?? 0) > (text.split(/\r?\n/)[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export function rowsToTasks(rows: Cell[][]): { tasks: Task[]; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (rows.length < 2) return { tasks: [], errors: ["The file has no data rows."], warnings };
  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const col = (k: string) => header.findIndex((h) => COLS[k].some((w) => h === w || h.startsWith(w)));
  const idx = Object.fromEntries(Object.keys(COLS).map((k) => [k, col(k)])) as Record<string, number>;
  for (const k of ["name", "team", "start", "duration"]) if (idx[k] < 0) errors.push(`Missing column "${COLS[k][0]}" (also accepted: ${COLS[k].slice(1, 4).join(", ")}).`);
  if (errors.length) return { tasks: [], errors, warnings };

  const tasks: Task[] = [];
  rows.slice(1).forEach((r, i) => {
    const name = String(r[idx.name] ?? "").trim();
    if (!name) return;
    const teamText = String(r[idx.team] ?? "").toLowerCase();
    const team = TEAM_WORDS.find(([, w]) => w.some((x) => teamText.includes(x)))?.[0];
    if (!team) {
      warnings.push(`Row ${i + 2}: unknown team "${r[idx.team] ?? ""}" – skipped.`);
      return;
    }
    const start = parseStart(r[idx.start]);
    if (start === undefined) {
      warnings.push(`Row ${i + 2}: start "${r[idx.start] ?? ""}" not understood – skipped.`);
      return;
    }
    const id = idx.id >= 0 && String(r[idx.id] ?? "").trim() ? String(r[idx.id]).trim() : `T${i + 1}`;
    const duration = Math.max(1, Math.round(num(r[idx.duration], 1)));
    const ms = idx.milestone >= 0 ? String(r[idx.milestone] ?? "").trim() : "";
    tasks.push({
      id,
      name,
      team,
      section: idx.section >= 0 ? String(r[idx.section] ?? "").trim().toUpperCase() : "",
      plannedStart: start,
      duration,
      crew: Math.round(num(idx.crew >= 0 ? r[idx.crew] : undefined, 3)),
      predecessors: idx.predecessors >= 0 ? String(r[idx.predecessors] ?? "").split(/[,;\s]+/).map((x) => x.replace(/(FS|SS|FF|SF).*$/i, "").trim()).filter(Boolean) : [],
      milestone: MILESTONES.some((m) => m.id === ms) ? ms : undefined,
      status: "planned",
      delayDays: 0,
      minDuration: duration > 1 ? duration - 1 : undefined,
      readiness: {
        predecessor: { state: "cleared" },
        material: { state: "cleared" },
        crew: { state: "cleared" },
        equipment: { state: "cleared" },
        permit: { state: "cleared" },
        drawings: { state: "cleared" },
      },
    });
  });
  const ids = new Set(tasks.map((t) => t.id));
  tasks.forEach((t) => {
    const unknown = t.predecessors.filter((p) => !ids.has(p));
    if (unknown.length) warnings.push(`${t.id}: predecessor(s) ${unknown.join(", ")} not in the file – ignored.`);
    t.predecessors = t.predecessors.filter((p) => ids.has(p));
  });
  if (!tasks.length) errors.push("No tasks could be read.");
  return { tasks, errors, warnings };
}

/** The current plan as a CSV template (semicolon, German Excel friendly). */
export function templateCsv(tasks: Task[]): string {
  const fmt = (d: number) => {
    const x = dayToDate(d);
    return `${String(x.getUTCDate()).padStart(2, "0")}.${String(x.getUTCMonth() + 1).padStart(2, "0")}.${x.getUTCFullYear()}`;
  };
  const lines = ["ID;Name;Team;Section;Start;Duration;Crew;Predecessors;Milestone"];
  tasks.forEach((t) => lines.push([t.id, t.name, t.team, t.section, fmt(t.plannedStart), t.duration, t.crew, t.predecessors.join(","), t.milestone ?? ""].join(";")));
  return lines.join("\n");
}
