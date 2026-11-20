"use client";

// Client-side state for the MVP, persisted in localStorage.
// Later: move to a shared database (e.g. Postgres) so all users see the same plan.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyActions, computeImpact, proposeReplan, schedule, withDelay, type ReplanProposal } from "./engine";
import { PERSONAS, PROJECT, SEED_TASKS, TEAMS } from "./seed";
import { dayLabel } from "./dates";
import type { ChangeRecord, Decision, DiaryEntry, Notice, Notification, PersonaId, ReadinessKey, Task } from "./types";

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
});

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...initial(),

      setPersona: (p) => set({ persona: p }),

      addEntry: (e) => {
        const progressDone = e.type === "progress" && e.fields.taskId && /fertig|erledigt|done|finished|completed|abgeschlossen/i.test(e.transcript);
        set((s) => ({
          entries: [e, ...s.entries],
          tasks: progressDone ? s.tasks.map((t) => (t.id === e.fields.taskId ? { ...t, status: "done" as const } : t)) : s.tasks,
          notifications:
            e.author !== "site-manager"
              ? [{ id: uid("NT"), createdAt: now(), to: ["site-manager"], text: `${personaName(e.author)} logged: ${e.summary}`, kind: "alert", readBy: [] }, ...s.notifications]
              : s.notifications,
        }));
      },

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
        set({
          tasks: after,
          pending: null,
          decisions: [
            { id: uid("D"), createdAt: now(), day: s.today, by: s.persona, kind: "reactive", text: `Re-plan approved after stoppage on ${trig.name} ${trig.section}: ${proposal.actions.length} action(s), ${proposal.idleHoursSaved} idle crew-hours avoided.` },
            ...s.decisions,
          ],
          notifications: [
            { id: uid("NT"), createdAt: now(), to: notify, kind: "replan", readBy: [], text: `Re-plan approved by ${personaName(s.persona)}: ${proposal.actions.map((a) => a.reason).join(" ")}` },
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
          notifications: [{ id: uid("NT"), createdAt: now(), to: impact.notify, kind: "change", readBy: [], text: `Delay recorded on ${proposal.triggerTaskId}; tasks moved: ${impact.changedTaskIds.join(", ") || "none"}.` }, ...s.notifications],
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
          notifications: [{ id: uid("NT"), createdAt: now(), to: Array.from(new Set<PersonaId>(["site-manager", team.id])), kind: "alert", readBy: [], text: `${personaName(s.persona)} cleared "${key}" for ${t.name} ${t.section}.` }, ...s.notifications],
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
