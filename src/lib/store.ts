"use client";

// Client-side state for the MVP, persisted in localStorage.
// Later: move to a shared database (e.g. Postgres) so all users see the same plan.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyActions, computeImpact, proposeReplan, schedule, withDelay, type ReplanProposal } from "./engine";
import { CONTACTS, PERSONAS, PROJECT, SEED_TASKS, TEAMS } from "./seed";
import { dayLabel } from "./dates";
import { applyNextSteps, changeMessages } from "./messages";
import type { ChangeRecord, Contact, Decision, DiaryEntry, Notice, Notification, OutMessage, PersonaId, ProposedChange, ReadinessKey, Task, Todo } from "./types";

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();
const personaName = (id: PersonaId) => PERSONAS.find((p) => p.id === id)?.name ?? id;

interface PendingReplan {
  entryId: string;
  proposal: ReplanProposal;
}

interface State {
  persona: PersonaId;
  today: number;
  tasks: Task[];
  entries: DiaryEntry[];
  notices: Notice[];
  notifications: Notification[];
  decisions: Decision[];
  changes: ChangeRecord[];
  pending: PendingReplan | null;
  selectedNoticeId: string | null;
  project: typeof PROJECT;
  contacts: Contact[];
  todos: Todo[];
  messages: OutMessage[];
  proposals: ProposedChange[];

  setPersona: (p: PersonaId) => void;
  addEntry: (e: DiaryEntry) => void;
  startReplan: (entryId: string) => ReplanProposal | null;
  approveReplan: () => void;
  rejectReplan: () => void;
  addNotice: (n: Notice) => void;
  selectNotice: (id: string | null) => void;
  updateNotice: (id: string, body: string) => void;
  approveNotice: (id: string) => void;
  clearBlocker: (taskId: string, key: ReadinessKey) => void;
  changeTask: (taskId: string, patch: Partial<Pick<Task, "plannedStart" | "duration" | "status">>, reason: string) => ChangeRecord | null;
  markRead: () => void;
  reset: () => void;
  addEntries: (es: DiaryEntry[]) => void;
  acceptProposal: (id: string) => void;
  rejectProposal: (id: string) => void;
  markMessageSent: (id: string, channel: NonNullable<OutMessage["channel"]>) => void;
  updateMessage: (id: string, body: string) => void;
  deleteMessage: (id: string) => void;
  addTodo: (t: Omit<Todo, "id" | "createdAt" | "status">) => void;
  toggleTodo: (id: string) => void;
  updateContact: (c: Contact) => void;
  updateProject: (p: Partial<typeof PROJECT>) => void;
  replaceTasks: (tasks: Task[], source: string) => void;
}

const initial = () => ({
  persona: "site-manager" as PersonaId,
  today: PROJECT.today,
  tasks: SEED_TASKS.map((t) => ({ ...t, readiness: { ...t.readiness } })),
  entries: [] as DiaryEntry[],
  notices: [] as Notice[],
  notifications: [] as Notification[],
  decisions: [] as Decision[],
  changes: [] as ChangeRecord[],
  pending: null as PendingReplan | null,
  selectedNoticeId: null as string | null,
  project: { ...PROJECT },
  contacts: CONTACTS.map((c) => ({ ...c })),
  todos: [] as Todo[],
  messages: [] as OutMessage[],
  proposals: [] as ProposedChange[],
});

type Snapshot = ReturnType<typeof initial>;

/** Everything that follows from saving one log: to-dos, message drafts, a proposed plan change, a notification. */
function entryDelta(s: Snapshot, e: DiaryEntry): Partial<Snapshot> {
  const progressDone = e.type === "progress" && e.fields.taskId && /fertig|erledigt|done|finished|completed|abgeschlossen/i.test(e.transcript);
  const { todos, messages } = applyNextSteps(e, s.contacts);
  const delay = Number(e.fields.estimatedDelayDays ?? 0);
  const task = s.tasks.find((t) => t.id === e.fields.taskId);
  // Stoppages go through the re-plan flow; any other reported delay becomes a proposal the site manager decides on.
  const proposal: ProposedChange | null =
    task && delay > 0 && e.type !== "stoppage" && task.status !== "done"
      ? { id: uid("P"), createdAt: now(), entryId: e.id, taskId: task.id, days: Math.round(delay), mode: task.status === "in-progress" ? "extend" : "shift", reason: e.transcript || e.summary, reportedBy: e.author, status: "pending" }
      : null;
  return {
    entries: [e, ...s.entries],
    tasks: progressDone ? s.tasks.map((t) => (t.id === e.fields.taskId ? { ...t, status: "done" as const } : t)) : s.tasks,
    todos: [...todos, ...s.todos],
    messages: [...messages, ...s.messages],
    proposals: proposal ? [proposal, ...s.proposals] : s.proposals,
    notifications:
      e.author !== "site-manager"
        ? [{ id: uid("NT"), createdAt: now(), to: ["site-manager"], from: e.author, text: `${personaName(e.author)} logged: ${e.summary}${proposal ? ` — proposes moving ${proposal.taskId} by ${proposal.days} day(s)` : ""}`, kind: "alert", readBy: [] }, ...s.notifications]
        : s.notifications,
  };
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...initial(),

      setPersona: (p) => set({ persona: p }),

      addEntry: (e) => set((s) => entryDelta(s, e)),

      addEntries: (es) =>
        set((s) => {
          let cur: Snapshot = { ...s };
          [...es].reverse().forEach((e) => (cur = { ...cur, ...entryDelta(cur, e) }));
          return cur;
        }),

      acceptProposal: (id) => {
        const s = get();
        const p = s.proposals.find((x) => x.id === id);
        if (!p || p.status !== "pending" || s.persona !== "site-manager") return;
        const t = s.tasks.find((x) => x.id === p.taskId);
        if (!t) return;
        const before = s.tasks;
        const sched0 = schedule(before);
        const after =
          p.mode === "extend"
            ? withDelay(before, p.taskId, p.days)
            : before.map((x) => (x.id === p.taskId ? { ...x, plannedStart: Math.max(x.plannedStart, sched0[x.id].es) + p.days } : x));
        const impact = computeImpact(before, after, p.taskId);
        const slipped = impact.slipsAfter.filter((m) => m.slip > 0 && m.slip > (impact.slipsBefore.find((b) => b.milestone.id === m.milestone.id)?.slip ?? 0));
        const patch: Partial<Task> = p.mode === "extend" ? { delayDays: t.delayDays + p.days } : { plannedStart: after.find((x) => x.id === p.taskId)!.plannedStart };
        const prev: Partial<Task> = p.mode === "extend" ? { delayDays: t.delayDays } : { plannedStart: t.plannedStart };
        set({
          tasks: after,
          proposals: s.proposals.map((x) => (x.id === id ? { ...x, status: "accepted", decidedAt: now() } : x)),
          todos: closeDecideTodos(s.todos, p.entryId),
          messages: [...changeMessages(before, after, p.taskId, p.reason, s.contacts), ...s.messages],
          changes: [{ id: uid("C"), createdAt: now(), by: s.persona, taskId: p.taskId, before: prev, after: patch, reason: p.reason, affectedTaskIds: impact.changedTaskIds, notified: impact.notify }, ...s.changes],
          decisions: [
            { id: uid("D"), createdAt: now(), day: s.today, by: s.persona, kind: "change", text: `Accepted: ${t.name} ${t.section} ${p.mode === "extend" ? "takes" : "moves"} ${p.days} day(s) ${p.mode === "extend" ? "longer" : "later"} (reported by ${personaName(p.reportedBy)}). ${impact.changedTaskIds.length} follow-on task(s) moved.${slipped.length ? ` ${slipped.map((m) => `${m.milestone.name} slips ${m.slip} d`).join("; ")}.` : ""}` },
            ...s.decisions,
          ],
          notifications: [
            { id: uid("NT"), createdAt: now(), to: impact.notify.filter((x) => x !== s.persona), from: s.persona, kind: "change", readBy: [], text: `Plan change accepted: ${t.name} ${t.section} +${p.days} day(s). Moved: ${impact.changedTaskIds.join(", ") || "none"}.` },
            ...s.notifications,
          ],
        });
      },

      rejectProposal: (id) => {
        const s = get();
        const p = s.proposals.find((x) => x.id === id);
        if (!p || p.status !== "pending") return;
        set({
          proposals: s.proposals.map((x) => (x.id === id ? { ...x, status: "rejected", decidedAt: now() } : x)),
          todos: closeDecideTodos(s.todos, p.entryId),
          decisions: [{ id: uid("D"), createdAt: now(), day: s.today, by: s.persona, kind: "change", text: `Rejected proposed delay of ${p.days} day(s) on ${p.taskId}: plan stays as is.` }, ...s.decisions],
        });
      },

      markMessageSent: (id, channel) => set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, status: "sent", sentAt: now(), channel } : m)) })),
      updateMessage: (id, body) => set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, body } : m)) })),
      deleteMessage: (id) => set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),
      addTodo: (t) => set((s) => ({ todos: [{ ...t, id: uid("T"), createdAt: now(), status: "open" }, ...s.todos] })),
      toggleTodo: (id) => set((s) => ({ todos: s.todos.map((t) => (t.id === id ? { ...t, status: t.status === "open" ? "done" : "open" } : t)) })),
      updateContact: (c) => set((s) => ({ contacts: s.contacts.some((x) => x.id === c.id) ? s.contacts.map((x) => (x.id === c.id ? c : x)) : [...s.contacts, c] })),
      updateProject: (p) => set((s) => ({ project: { ...s.project, ...p } })),
      replaceTasks: (tasks, source) =>
        set((s) => ({
          tasks,
          pending: null,
          proposals: [],
          decisions: [{ id: uid("D"), createdAt: now(), day: s.today, by: s.persona, kind: "change", text: `Site plan initialised from ${source}: ${tasks.length} tasks.` }, ...s.decisions],
        })),

      startReplan: (entryId) => {
        const s = get();
        const e = s.entries.find((x) => x.id === entryId);
        if (!e?.fields.taskId) return null;
        const hour = e.fields.startTime ? parseInt(String(e.fields.startTime).split(":")[0], 10) : new Date().getHours();
        const proposal = proposeReplan(s.tasks, e.fields.taskId, Number(e.fields.estimatedDelayDays ?? 1) || 1, s.today, hour);
        set({ pending: { entryId, proposal } });
        return proposal;
      },

      approveReplan: () => {
        const s = get();
        if (!s.pending) return;
        const { proposal } = s.pending;
        const before = s.tasks;
        const after = applyActions(withDelay(before, proposal.triggerTaskId, proposal.delayDays), proposal.actions);
        const impact = computeImpact(before, after, proposal.triggerTaskId);
        const teams = new Set([...impact.affectedTeams, ...proposal.actions.map((a) => a.team)]);
        const notify = Array.from(new Set<PersonaId>(["site-manager", ...teams]));
        const trig = before.find((t) => t.id === proposal.triggerTaskId)!;
        const src = s.entries.find((e) => e.id === s.pending!.entryId);
        const reason = src?.transcript || src?.summary || "Stillstand";
        set({
          tasks: after,
          pending: null,
          messages: [...changeMessages(before, after, proposal.triggerTaskId, reason, s.contacts), ...s.messages],
          decisions: [
            { id: uid("D"), createdAt: now(), day: s.today, by: s.persona, kind: "reactive", text: `Re-plan approved after stoppage on ${trig.name} ${trig.section}: ${proposal.actions.length} action(s), ${proposal.idleHoursSaved} idle crew-hours avoided.` },
            ...s.decisions,
          ],
          notifications: [
            { id: uid("NT"), createdAt: now(), to: notify, from: s.persona, kind: "replan", readBy: [], text: `Re-plan approved by ${personaName(s.persona)}: ${proposal.actions.map((a) => a.reason).join(" ")}` },
            ...s.notifications,
          ],
        });
      },

      rejectReplan: () => {
        const s = get();
        if (!s.pending) return;
        const { proposal } = s.pending;
        const before = s.tasks;
        const after = withDelay(before, proposal.triggerTaskId, proposal.delayDays);
        const impact = computeImpact(before, after, proposal.triggerTaskId);
        set({
          tasks: after,
          pending: null,
          decisions: [{ id: uid("D"), createdAt: now(), day: s.today, by: s.persona, kind: "reactive", text: `Delay of ${proposal.delayDays} day(s) recorded on ${proposal.triggerTaskId}; proposed re-plan rejected.` }, ...s.decisions],
          notifications: [{ id: uid("NT"), createdAt: now(), to: impact.notify, from: s.persona, kind: "change", readBy: [], text: `Delay recorded on ${proposal.triggerTaskId}; tasks moved: ${impact.changedTaskIds.join(", ") || "none"}.` }, ...s.notifications],
        });
      },

      addNotice: (n) => set((s) => ({ notices: [n, ...s.notices], selectedNoticeId: n.id })),
      selectNotice: (id) => set({ selectedNoticeId: id }),
      updateNotice: (id, body) => set((s) => ({ notices: s.notices.map((n) => (n.id === id && n.status === "draft" ? { ...n, body } : n)) })),

      approveNotice: (id) => {
        const s = get();
        const n = s.notices.find((x) => x.id === id);
        if (!n || s.persona !== "site-manager") return;
        set({
          notices: s.notices.map((x) => (x.id === id ? { ...x, status: "approved", approvedAt: now() } : x)),
          decisions:
            n.mode === "report"
              ? s.decisions
              : [{ id: uid("D"), createdAt: now(), day: s.today, by: s.persona, kind: n.mode === "preventive" ? "preventive" : "reactive", text: `Approved: ${n.title} → ${n.addressee}` }, ...s.decisions],
        });
      },

      clearBlocker: (taskId, key) => {
        const s = get();
        const t = s.tasks.find((x) => x.id === taskId);
        if (!t) return;
        const team = TEAMS.find((x) => x.id === t.team)!;
        set({
          tasks: s.tasks.map((x) => (x.id === taskId ? { ...x, readiness: { ...x.readiness, [key]: { ...x.readiness[key], state: "cleared" } } } : x)),
          decisions: [{ id: uid("D"), createdAt: now(), day: s.today, by: s.persona, kind: "preventive", text: `Blocker cleared on ${t.name} ${t.section}: ${key} (${x(t.readiness[key]?.note)})` }, ...s.decisions],
          notifications: [{ id: uid("NT"), createdAt: now(), to: Array.from(new Set<PersonaId>(["site-manager", team.id])), from: s.persona, kind: "alert", readBy: [], text: `${personaName(s.persona)} cleared "${key}" for ${t.name} ${t.section}.` }, ...s.notifications],
        });
      },

      changeTask: (taskId, patch, reason) => {
        const s = get();
        const t = s.tasks.find((x) => x.id === taskId);
        if (!t) return null;
        const after = s.tasks.map((x) => (x.id === taskId ? { ...x, ...patch } : x));
        const impact = computeImpact(s.tasks, after, taskId);
        const before: Partial<Task> = {};
        (Object.keys(patch) as (keyof typeof patch)[]).forEach((k) => ((before as Record<string, unknown>)[k] = t[k]));
        const rec: ChangeRecord = { id: uid("C"), createdAt: now(), by: s.persona, taskId, before, after: patch, reason, affectedTaskIds: impact.changedTaskIds, notified: impact.notify };
        const slipped = impact.slipsAfter.filter((m) => m.slip > 0 && m.slip > (impact.slipsBefore.find((b) => b.milestone.id === m.milestone.id)?.slip ?? 0));
        const sched = schedule(after);
        const moved = impact.changedTaskIds.map((id) => `${id} → starts ${dayLabel(sched[id].es)}`).join(", ");
        set({
          tasks: after,
          changes: [rec, ...s.changes],
          decisions: [{ id: uid("D"), createdAt: now(), day: s.today, by: s.persona, kind: "change", text: `${personaName(s.persona)} changed ${t.name} ${t.section} (${describePatch(before, patch)}). ${reason}` }, ...s.decisions],
          notifications: [
            {
              id: uid("NT"),
              createdAt: now(),
              to: impact.notify.filter((p) => p !== s.persona),
              from: s.persona,
              kind: "change",
              readBy: [],
              text: `${personaName(s.persona)} changed ${t.name} ${t.section} (${describePatch(before, patch)}).${impact.changedTaskIds.length ? ` Your tasks move: ${moved}.` : ""}${slipped.length ? ` ⚠ ${slipped.map((m) => `${m.milestone.name} slips ${m.slip} day(s)`).join("; ")}.` : ""}${reason ? ` Reason: ${reason}` : ""}`,
            },
            ...s.notifications,
          ],
        });
        return rec;
      },

      markRead: () => {
        const p = get().persona;
        set((s) => ({ notifications: s.notifications.map((n) => (n.to.includes(p) && !n.readBy.includes(p) ? { ...n, readBy: [...n.readBy, p] } : n)) }));
      },

      reset: () => set(initial()),
    }),
    { name: "site-assistant-v1" }
  )
);

/** The "decide on plan change" to-do from the same log is done once the proposal is decided. */
function closeDecideTodos(todos: Todo[], entryId: string): Todo[] {
  return todos.map((t) => (t.entryId === entryId && /plan change|planänderung/i.test(t.text) ? { ...t, status: "done" as const } : t));
}

function x(v?: string) {
  return v ?? "";
}

function describePatch(before: Partial<Task>, patch: Partial<Task>) {
  const parts: string[] = [];
  if (patch.plannedStart !== undefined) parts.push(`start ${dayLabel(before.plannedStart ?? 0)} → ${dayLabel(patch.plannedStart)}`);
  if (patch.duration !== undefined) parts.push(`duration ${before.duration} → ${patch.duration} d`);
  if (patch.status !== undefined) parts.push(`status ${before.status} → ${patch.status}`);
  return parts.join(", ");
}
