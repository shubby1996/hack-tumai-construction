"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { computeImpact, schedule } from "@/lib/engine";
import { dayLabel } from "@/lib/dates";
import { MILESTONES, PERSONAS, TEAMS } from "@/lib/seed";
import type { ReadinessKey, Task, TaskStatus } from "@/lib/types";
import { Avatar, Badge, Button, inputCls } from "./ui";

const KEYS: ReadinessKey[] = ["predecessor", "material", "crew", "equipment", "permit", "drawings"];

export function canEdit(persona: string, t: Task) {
  return persona === "site-manager" || persona === t.team;
}

export const statusTone = (s: TaskStatus) => (s === "blocked" ? "red" : s === "done" ? "green" : s === "in-progress" ? "blue" : "stone");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-3 py-1.5 text-sm">
      <span className="pt-0.5 text-[#6d6e6f]">{label}</span>
      <div className="min-w-0 text-[#1e1f21]">{children}</div>
    </div>
  );
}

export function TaskEditor({ task, onDone }: { task: Task; onDone?: () => void }) {
  const { tasks, persona } = useStore();
  const changeTask = useStore((s) => s.changeTask);
  const clearBlocker = useStore((s) => s.clearBlocker);
  const [shift, setShift] = useState(0);
  const [dur, setDur] = useState(task.duration);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [reason, setReason] = useState("");
  const sched = schedule(tasks);
  const team = TEAMS.find((x) => x.id === task.team)!;
  const foreman = PERSONAS.find((p) => p.team === task.team)!;
  const editable = canEdit(persona, task);
  const milestone = MILESTONES.find((m) => m.id === task.milestone);

  const patch: Partial<Pick<Task, "plannedStart" | "duration" | "status">> = {};
  if (shift) patch.plannedStart = Math.max(0, task.plannedStart + shift);
  if (dur !== task.duration) patch.duration = Math.max(1, dur);
  if (status !== task.status) patch.status = status;
  const dirty = Object.keys(patch).length > 0;
  const preview = dirty ? computeImpact(tasks, tasks.map((t) => (t.id === task.id ? { ...t, ...patch } : t)), task.id) : null;
  const newSlips = preview?.slipsAfter.filter((m) => m.slip > (preview.slipsBefore.find((b) => b.milestone.id === m.milestone.id)?.slip ?? 0)) ?? [];

  return (
    <div className="space-y-4">
      <div className="divide-y divide-[#f0efee]">
        <Row label="Assignee">
          <span className="inline-flex items-center gap-2">
            <Avatar id={foreman.id} name={foreman.name} />
            {foreman.name} <span className="text-[#6d6e6f]">· {team.company}</span>
          </span>
        </Row>
        <Row label="Dates">
          {dayLabel(sched[task.id].es)} → {dayLabel(sched[task.id].ef)}
          {task.delayDays ? <span className="ml-2 text-[#b42318]">+{task.delayDays}d delay</span> : null}
        </Row>
        <Row label="Status">
          <Badge tone={statusTone(task.status)}>{task.status}</Badge>
        </Row>
        <Row label="Projects">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: team.color }} /> {team.name} · Section {task.section || "–"}
          </span>
        </Row>
        <Row label="Crew">{task.crew} workers</Row>
        <Row label="Depends on">{task.predecessors.length ? task.predecessors.map((p) => tasks.find((t) => t.id === p)).map((t) => (t ? `${t.name} ${t.section}` : "")).join(", ") : "—"}</Row>
        {milestone && (
          <Row label="Milestone">
            <span className="text-[#8a5a00]">◆ {milestone.name}</span> <span className="text-[#6d6e6f]">· target {dayLabel(milestone.targetDay)}</span>
          </Row>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-[#1e1f21]">Readiness</p>
        <div className="flex flex-wrap gap-1.5">
          {KEYS.map((k) => {
            const item = task.readiness[k];
            const open = item?.state === "open";
            return (
              <span key={k} title={item?.note} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${open ? "bg-[#fde2e0] text-[#b42318]" : "bg-[#d8f2e4] text-[#0f6b3e]"}`}>
                {open ? "✗" : "✓"} {k}
                {open && editable && (
                  <button className="ml-1 underline" onClick={() => clearBlocker(task.id, k)}>
                    clear
                  </button>
                )}
              </span>
            );
          })}
        </div>
        {KEYS.filter((k) => task.readiness[k]?.state === "open").map((k) => (
          <p key={k} className="mt-1.5 text-xs text-[#b42318]">
            {k}: {task.readiness[k]?.note} — owner: {task.readiness[k]?.owner}, due {dayLabel(task.readiness[k]?.dueDay ?? 0)}
          </p>
        ))}
      </div>

      {editable ? (
        <div className="space-y-3 rounded-xl border border-[#e8e6e3] p-4">
          <p className="text-sm font-medium text-[#1e1f21]">Change this task</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24 text-[#6d6e6f]">Planned start</span>
            <Button onClick={() => setShift(shift - 1)}>−1 day</Button>
            <span className="w-28 text-center font-medium">{dayLabel(Math.max(0, task.plannedStart + shift))}</span>
            <Button onClick={() => setShift(shift + 1)}>+1 day</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24 text-[#6d6e6f]">Duration</span>
            <Button onClick={() => setDur(Math.max(1, dur - 1))}>−</Button>
            <span className="w-14 text-center font-medium">{dur} d</span>
            <Button onClick={() => setDur(dur + 1)}>+</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24 text-[#6d6e6f]">Status</span>
            <select className={`${inputCls} w-40`} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {(["planned", "in-progress", "blocked", "done"] as TaskStatus[]).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <input className={inputCls} placeholder="Reason (goes into the change log)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {preview && (
            <div className={`rounded-md p-2 text-xs ${newSlips.length ? "bg-[#fde2e0] text-[#b42318]" : "bg-[#dfe9fb] text-[#2d5bb8]"}`}>
              {preview.changedTaskIds.length ? `Moves ${preview.changedTaskIds.join(", ")}. ` : "No other task moves. "}
              Notifies {preview.notify.filter((p) => p !== persona).map((p) => PERSONAS.find((x) => x.id === p)?.name).join(", ") || "nobody"}.
              {newSlips.length ? ` ⚠ ${newSlips.map((m) => `${m.milestone.name} slips ${m.slip} day(s)`).join("; ")}.` : ""}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={!dirty}
              onClick={() => {
                changeTask(task.id, patch, reason);
                setShift(0);
                setReason("");
                onDone?.();
              }}
            >
              Apply change & notify
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => (setShift(0), setDur(task.duration), setStatus(task.status))}>
                Undo
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-[#6d6e6f]">Only {team.company} or the site manager can change this task.</p>
      )}
    </div>
  );
}
