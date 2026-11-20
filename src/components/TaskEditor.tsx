"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { computeImpact, schedule } from "@/lib/engine";
import { dayLabel } from "@/lib/dates";
import { MILESTONES, PERSONAS, TEAMS } from "@/lib/seed";
import type { ReadinessKey, Task, TaskStatus } from "@/lib/types";
import { Badge, Button, inputCls } from "./ui";

const KEYS: ReadinessKey[] = ["predecessor", "material", "crew", "equipment", "permit", "drawings"];

export function canEdit(persona: string, t: Task) {
  return persona === "site-manager" || persona === t.team;
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
  const editable = canEdit(persona, task);

  const patch: Partial<Pick<Task, "plannedStart" | "duration" | "status">> = {};
  if (shift) patch.plannedStart = Math.max(0, task.plannedStart + shift);
  if (dur !== task.duration) patch.duration = Math.max(1, dur);
  if (status !== task.status) patch.status = status;
  const dirty = Object.keys(patch).length > 0;
  const preview = dirty ? computeImpact(tasks, tasks.map((t) => (t.id === task.id ? { ...t, ...patch } : t)), task.id) : null;
  const newSlips = preview?.slipsAfter.filter((m) => m.slip > (preview.slipsBefore.find((b) => b.milestone.id === m.milestone.id)?.slip ?? 0)) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: team.color }} />
        <h3 className="font-semibold text-stone-900">
          {task.id} · {task.name} {task.section}
        </h3>
        <Badge tone={task.status === "blocked" ? "red" : task.status === "done" ? "green" : task.status === "in-progress" ? "blue" : "stone"}>{task.status}</Badge>
        {task.milestone && <Badge tone="amber">◆ {MILESTONES.find((m) => m.id === task.milestone)?.name}</Badge>}
      </div>
      <p className="text-sm text-stone-600">
        {team.company} · {task.crew} workers · {dayLabel(sched[task.id].es)} → {dayLabel(sched[task.id].ef)}
        {task.delayDays ? ` (incl. ${task.delayDays} day delay)` : ""}
        {task.predecessors.length ? ` · after ${task.predecessors.join(", ")}` : ""}
      </p>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Readiness</p>
        <div className="flex flex-wrap gap-1.5">
          {KEYS.map((k) => {
            const item = task.readiness[k];
            const open = item?.state === "open";
            return (
              <span key={k} title={item?.note} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${open ? "bg-red-100 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
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
          <p key={k} className="mt-1 text-xs text-red-700">
            {k}: {task.readiness[k]?.note} — owner: {task.readiness[k]?.owner}, due {dayLabel(task.readiness[k]?.dueDay ?? 0)}
          </p>
        ))}
      </div>

      {editable ? (
        <div className="space-y-2 rounded-lg bg-stone-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Change this task</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-stone-600">Planned start</span>
            <Button onClick={() => setShift(shift - 1)}>−1 day</Button>
            <span className="w-28 text-center font-medium">{dayLabel(Math.max(0, task.plannedStart + shift))}</span>
            <Button onClick={() => setShift(shift + 1)}>+1 day</Button>
            <span className="ml-2 text-stone-600">Duration</span>
            <Button onClick={() => setDur(Math.max(1, dur - 1))}>−</Button>
            <span className="w-14 text-center font-medium">{dur} d</span>
            <Button onClick={() => setDur(dur + 1)}>+</Button>
            <select className={`${inputCls} w-36`} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {(["planned", "in-progress", "blocked", "done"] as TaskStatus[]).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <input className={inputCls} placeholder="Reason (goes into the change log)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {preview && (
            <div className={`rounded-md p-2 text-xs ${newSlips.length ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-800"}`}>
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
        <p className="text-xs text-stone-500">Only {team.company} or the site manager can change this task.</p>
      )}
    </div>
  );
}
