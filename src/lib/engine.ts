// Plan engine: scheduling, impact of changes, preventive scan and reactive re-plan.
// Deliberately simple and explainable: a forward pass over the task graph,
// plus greedy recovery (crashing) and pull-forward of unblocked work.

import { MILESTONES, PERSONAS, SETTINGS } from "./seed";
import type {
  Milestone,
  PersonaId,
  ReadinessKey,
  Settings,
  Task,
  TeamId,
} from "./types";

export interface Slot {
  es: number; // earliest start (working-day index)
  ef: number; // earliest finish (inclusive)
}
export type Schedule = Record<string, Slot>;

export const effectiveDuration = (t: Task) => Math.max(1, t.duration + t.delayDays);

/** Topological order (Kahn). Cycles are broken by input order. */
export function topoOrder(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indeg = new Map<string, number>();
  tasks.forEach((t) => indeg.set(t.id, t.predecessors.filter((p) => byId.has(p)).length));
  const queue = tasks.filter((t) => indeg.get(t.id) === 0);
  const out: Task[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const t = queue.shift()!;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    tasks
      .filter((s) => s.predecessors.includes(t.id))
      .forEach((s) => {
        indeg.set(s.id, (indeg.get(s.id) ?? 1) - 1);
        if (indeg.get(s.id) === 0) queue.push(s);
      });
  }
  tasks.forEach((t) => !seen.has(t.id) && out.push(t));
  return out;
}

/** Forward pass: a task starts at its planned day or after its last predecessor. */
export function schedule(tasks: Task[]): Schedule {
  const s: Schedule = {};
  for (const t of topoOrder(tasks)) {
    const predFinish = Math.max(-1, ...t.predecessors.map((p) => s[p]?.ef ?? -1));
    const es = Math.max(t.plannedStart, predFinish + 1);
    s[t.id] = { es, ef: es + effectiveDuration(t) - 1 };
  }
  return s;
}

export function milestoneSlips(tasks: Task[], sched: Schedule, milestones: Milestone[] = MILESTONES) {
  return milestones.map((m) => {
    const t = tasks.find((x) => x.milestone === m.id);
    const finish = t ? sched[t.id]?.ef ?? m.targetDay : m.targetDay;
    return { milestone: m, finish, slip: Math.max(0, finish - m.targetDay) };
  });
}

export function successorsMap(tasks: Task[]) {
  const m = new Map<string, string[]>();
  tasks.forEach((t) => m.set(t.id, []));
  tasks.forEach((t) => t.predecessors.forEach((p) => m.get(p)?.push(t.id)));
  return m;
}

/** All tasks downstream of `id` (transitive successors). */
export function downstream(tasks: Task[], id: string): string[] {
  const succ = successorsMap(tasks);
  const out: string[] = [];
  const stack = [...(succ.get(id) ?? [])];
  while (stack.length) {
    const x = stack.pop()!;
    if (out.includes(x)) continue;
    out.push(x);
    stack.push(...(succ.get(x) ?? []));
  }
  return out;
}

/** Slack to the nearest milestone the task feeds (smaller = more critical). */
export function slackToMilestone(tasks: Task[], sched: Schedule, id: string): number {
  const ids = [id, ...downstream(tasks, id)];
  const slacks = ids
    .map((x) => tasks.find((t) => t.id === x))
    .filter((t): t is Task => !!t && !!t.milestone)
    .map((t) => {
      const m = MILESTONES.find((mm) => mm.id === t.milestone)!;
      return m.targetDay - sched[t.id].ef;
    });
  return slacks.length ? Math.min(...slacks) : 99;
}

export const personaForTeam = (team: TeamId): PersonaId => team;

export function teamName(team: TeamId) {
  return PERSONAS.find((p) => p.team === team)?.company ?? team;
}

// ---------------------------------------------------------------- impact

export interface Impact {
  changedTaskIds: string[]; // tasks whose start or finish moved (excluding the source)
  affectedTeams: TeamId[];
  notify: PersonaId[];
  slipsBefore: ReturnType<typeof milestoneSlips>;
  slipsAfter: ReturnType<typeof milestoneSlips>;
}

export function computeImpact(before: Task[], after: Task[], sourceId?: string): Impact {
  const s0 = schedule(before);
  const s1 = schedule(after);
  const changed = after
    .filter((t) => t.id !== sourceId)
    .filter((t) => s0[t.id] && (s0[t.id].es !== s1[t.id].es || s0[t.id].ef !== s1[t.id].ef))
    .map((t) => t.id);
  const source = after.find((t) => t.id === sourceId);
  const teams = Array.from(
    new Set(changed.map((id) => after.find((t) => t.id === id)!.team).filter((tm) => tm !== source?.team))
  );
  const notify = Array.from(new Set<PersonaId>(["site-manager", ...teams.map(personaForTeam)]));
  return {
    changedTaskIds: changed,
    affectedTeams: teams,
    notify,
    slipsBefore: milestoneSlips(before, s0),
    slipsAfter: milestoneSlips(after, s1),
  };
}

// ---------------------------------------------------------------- preventive

export interface BlockerAlert {
  taskId: string;
  key: ReadinessKey;
  note: string;
  owner: string;
  dueDay: number;
  startDay: number;
  slack: number;
  score: number;
}

export function preventiveScan(tasks: Task[], today: number, settings: Settings = SETTINGS): BlockerAlert[] {
  const sched = schedule(tasks);
  const alerts: BlockerAlert[] = [];
  for (const t of tasks) {
    if (t.status === "done") continue;
    const start = sched[t.id].es;
    if (start < today || start > today + settings.preventiveHorizonDays) continue;
    for (const [k, item] of Object.entries(t.readiness) as [ReadinessKey, NonNullable<Task["readiness"][ReadinessKey]>][]) {
      if (!item || item.state !== "open") continue;
      const due = item.dueDay ?? start - 1;
      const slack = slackToMilestone(tasks, sched, t.id);
      // Earlier due date and smaller milestone slack rank first.
      const score = (due - today) * 10 + Math.min(slack, 9);
      alerts.push({ taskId: t.id, key: k, note: item.note ?? `${k} not ready`, owner: item.owner ?? "Unassigned", dueDay: due, startDay: start, slack, score });
    }
  }
  return alerts.sort((a, b) => a.score - b.score).slice(0, settings.maxAlerts);
}

// ---------------------------------------------------------------- reactive re-plan

export interface ReplanAction {
  kind: "crash" | "pull-forward";
  taskId: string;
  team: TeamId;
  fromDay: number;
  toDay: number;
  newDuration?: number;
  extraCrew?: number;
  idleHoursSaved?: number;
  reason: string;
}

export interface ReplanProposal {
  id: string;
  triggerTaskId: string;
  delayDays: number;
  stoppageHoursToday: number;
  impact: Impact; // delay alone, before recovery
  actions: ReplanAction[];
  slipsAfterReplan: ReturnType<typeof milestoneSlips>;
  idleHoursSaved: number;
  explanation: string[];
}

/** Apply the delay to the trigger task (pure). */
export function withDelay(tasks: Task[], taskId: string, delayDays: number): Task[] {
  return tasks.map((t) =>
    t.id === taskId ? { ...t, delayDays: t.delayDays + delayDays, status: "blocked" as const } : t
  );
}

export function applyActions(tasks: Task[], actions: ReplanAction[]): Task[] {
  return tasks.map((t) => {
    const a = actions.filter((x) => x.taskId === t.id);
    if (!a.length) return t;
    let next = { ...t };
    for (const act of a) {
      if (act.kind === "crash" && act.newDuration) next = { ...next, duration: act.newDuration, crew: next.crew + (act.extraCrew ?? 0) };
      if (act.kind === "pull-forward") next = { ...next, plannedStart: act.toDay };
    }
    return next;
  });
}

function teamWorkDays(tasks: Task[], sched: Schedule, team: TeamId): Set<number> {
  const days = new Set<number>();
  tasks
    .filter((t) => t.team === team && t.status !== "done")
    .forEach((t) => {
      for (let d = sched[t.id].es; d <= sched[t.id].ef; d++) days.add(d);
    });
  return days;
}

function isReadyExceptPredecessor(t: Task) {
  return (Object.entries(t.readiness) as [ReadinessKey, { state: string } | undefined][]) //
    .every(([k, v]) => k === "predecessor" || !v || v.state === "cleared");
}

/** Find a task of `team` that can be pulled forward to start on `day`. */
function findPullForward(tasks: Task[], sched: Schedule, team: TeamId, day: number, exclude: Set<string>): Task | undefined {
  return tasks
    .filter((t) => t.team === team && t.status === "planned" && !exclude.has(t.id))
    .filter((t) => sched[t.id].es > day)
    .filter((t) => t.predecessors.every((p) => sched[p] && sched[p].ef < day))
    .filter(isReadyExceptPredecessor)
    .sort((a, b) => sched[a.id].es - sched[b.id].es)[0];
}

export function proposeReplan(
  tasks: Task[],
  triggerTaskId: string,
  delayDays: number,
  today: number,
  stoppageStartHour = 10,
  settings: Settings = SETTINGS
): ReplanProposal {
  const delayed = withDelay(tasks, triggerTaskId, delayDays);
  const impact = computeImpact(tasks, delayed, triggerTaskId);
  const trigger = tasks.find((t) => t.id === triggerTaskId)!;
  const actions: ReplanAction[] = [];
  const explanation: string[] = [];
  let current = delayed;

  // 1) Recover milestone slip by crashing downstream tasks (adds one crew, within limits).
  const crashesPerDay = new Map<number, number>();
  for (const slip of impact.slipsAfter.filter((s) => s.slip > 0)) {
    let remaining = slip.slip;
    const msTask = current.find((t) => t.milestone === slip.milestone.id);
    if (!msTask) continue;
    const chain = downstream(current, triggerTaskId).filter(
      (id) => id === msTask.id || downstream(current, id).includes(msTask.id)
    );
    const sched = schedule(current);
    const candidates = chain
      .map((id) => current.find((t) => t.id === id)!)
      .filter((t) => t.status === "planned" && t.minDuration && t.minDuration < t.duration)
      .sort((a, b) => sched[a.id].es - sched[b.id].es);
    for (const c of candidates) {
      if (remaining <= 0) break;
      const day = schedule(current)[c.id].es;
      if ((crashesPerDay.get(day) ?? 0) >= settings.maxExtraCrewsPerDay) continue;
      const cut = Math.min(remaining, c.duration - (c.minDuration ?? c.duration));
      const act: ReplanAction = {
        kind: "crash",
        taskId: c.id,
        team: c.team,
        fromDay: day,
        toDay: day,
        newDuration: c.duration - cut,
        extraCrew: 1,
        reason: `Add one extra crew to "${c.name} ${c.section}" (${c.duration} → ${c.duration - cut} day${c.duration - cut > 1 ? "s" : ""}) to recover ${cut} day${cut > 1 ? "s" : ""} on "${slip.milestone.name}".`,
      };
      actions.push(act);
      crashesPerDay.set(day, (crashesPerDay.get(day) ?? 0) + 1);
      current = applyActions(current, [act]);
      remaining -= cut;
    }
  }

  // 2) Give idle crews unblocked work (pull forward).
  const exclude = new Set<string>([triggerTaskId, ...actions.map((a) => a.taskId)]);
  const hoursLeftToday = Math.max(0, Math.min(settings.hoursPerDay, 16 - stoppageStartHour));
  // 2a) The stopped team, for the rest of today.
  const pfToday = findPullForward(current, schedule(current), trigger.team, today, exclude);
  if (pfToday && hoursLeftToday > 0) {
    const hours = trigger.crew * hoursLeftToday;
    const act: ReplanAction = {
      kind: "pull-forward",
      taskId: pfToday.id,
      team: pfToday.team,
      fromDay: schedule(current)[pfToday.id].es,
      toDay: today,
      idleHoursSaved: hours,
      reason: `${trigger.team === pfToday.team ? "Stopped crew" : "Crew"} moves to "${pfToday.name} ${pfToday.section}" for the rest of today: it is unblocked and fully ready. Saves about ${hours} idle crew-hours.`,
    };
    actions.push(act);
    exclude.add(pfToday.id);
    current = applyActions(current, [act]);
  }
  // 2b) Other teams that lose work days inside the horizon because of the delay.
  const s0 = schedule(tasks);
  const sNow = schedule(current);
  for (const team of impact.affectedTeams) {
    const before = teamWorkDays(tasks, s0, team);
    const after = teamWorkDays(current, sNow, team);
    const idleDays = [...before].filter((d) => !after.has(d) && d >= today && d <= today + settings.preventiveHorizonDays).sort((a, b) => a - b);
    for (const day of idleDays) {
      const sched = schedule(current);
      if (teamWorkDays(current, sched, team).has(day)) continue;
      const pf = findPullForward(current, sched, team, day, exclude);
      if (!pf) continue;
      const crew = pf.crew;
      const hours = crew * settings.hoursPerDay;
      const act: ReplanAction = {
        kind: "pull-forward",
        taskId: pf.id,
        team,
        fromDay: sched[pf.id].es,
        toDay: day,
        idleHoursSaved: hours,
        reason: `"${pf.name} ${pf.section}" moves forward to fill the gap the delay leaves for ${teamName(team)}; its predecessors finish before then and it is fully ready. Saves about ${hours} idle crew-hours.`,
      };
      actions.push(act);
      exclude.add(pf.id);
      current = applyActions(current, [act]);
    }
  }

  const slipsAfterReplan = milestoneSlips(current, schedule(current));
  const idleHoursSaved = actions.reduce((s, a) => s + (a.idleHoursSaved ?? 0), 0);

  const worst = impact.slipsAfter.filter((s) => s.slip > 0);
  explanation.push(
    `"${trigger.name} ${trigger.section}" is delayed by ${delayDays} day${delayDays > 1 ? "s" : ""}. ` +
      (impact.changedTaskIds.length
        ? `${impact.changedTaskIds.length} downstream task${impact.changedTaskIds.length > 1 ? "s" : ""} move, affecting ${impact.affectedTeams.map(teamName).join(", ") || "no other team"}.`
        : "No downstream task moves.")
  );
  if (worst.length) {
    explanation.push(
      `Without action: ${worst.map((s) => `"${s.milestone.name}" slips ${s.slip} day${s.slip > 1 ? "s" : ""}`).join("; ")}.`
    );
  } else {
    explanation.push("Without action, no milestone slips (there is enough float).");
  }
  const stillSlipping = slipsAfterReplan.filter((s) => s.slip > 0);
  explanation.push(
    stillSlipping.length
      ? `With this re-plan: ${stillSlipping.map((s) => `"${s.milestone.name}" still slips ${s.slip} day${s.slip > 1 ? "s" : ""}`).join("; ")}.`
      : "With this re-plan, all milestones hold."
  );
  if (idleHoursSaved) explanation.push(`About ${idleHoursSaved} idle crew-hours avoided.`);
  explanation.push(
    `Limits respected: at most ${settings.maxExtraCrewsPerDay} extra crew per day, no overtime used.`
  );

  return {
    id: `RP-${Date.now().toString(36)}`,
    triggerTaskId,
    delayDays,
    stoppageHoursToday: hoursLeftToday,
    impact,
    actions,
    slipsAfterReplan,
    idleHoursSaved,
    explanation,
  };
}
