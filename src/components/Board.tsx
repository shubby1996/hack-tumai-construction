"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { schedule } from "@/lib/engine";
import { dayLabel } from "@/lib/dates";
import { PERSONAS, TEAMS } from "@/lib/seed";
import type { TaskStatus } from "@/lib/types";
import { canEdit } from "./TaskEditor";
import { Avatar, CheckCircle } from "./ui";

const COLUMNS: { status: TaskStatus; label: string; dot: string }[] = [
  { status: "planned", label: "Planned", dot: "#9ca0a5" },
  { status: "in-progress", label: "In progress", dot: "#4573d2" },
  { status: "blocked", label: "Blocked", dot: "#e8384f" },
  { status: "done", label: "Done", dot: "#58a182" },
];

/** Kanban board by status. Drag cards between columns (desktop) or use the card menu (phones). */
export function Board({ onOpen }: { onOpen: (id: string) => void }) {
  const { tasks, persona, today } = useStore();
  const changeTask = useStore((s) => s.changeTask);
  const sched = schedule(tasks);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);

  const drop = (status: TaskStatus, id?: string) => {
    const t = tasks.find((x) => x.id === (id || dragId));
    setDragId(null);
    setOverCol(null);
    if (t && t.status !== status && canEdit(persona, t)) changeTask(t.id, { status }, "Moved on board");
  };

  return (
    <div className="-mx-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0">
      <div className="grid min-w-[880px] grid-cols-4 gap-3">
        {COLUMNS.map((col) => {
          const list = tasks.filter((t) => t.status === col.status).sort((a, b) => sched[a.id].es - sched[b.id].es);
          return (
            <div
              key={col.status}
              data-col={col.status}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(col.status);
              }}
              onDragLeave={() => setOverCol(null)}
              onDrop={(e) => {
                e.preventDefault();
                drop(col.status, e.dataTransfer.getData("text/plain"));
              }}
              className={`rounded-2xl p-2 transition ${overCol === col.status ? "bg-[#e5e9f4] ring-2 ring-[#4573d2]/40" : "bg-[#f3f2f1]"}`}
            >
              <p className="flex items-center gap-2 px-2 pb-2 pt-1 text-sm font-medium text-[#1e1f21]">
                <span className="h-2 w-2 rounded-full" style={{ background: col.dot }} />
                {col.label} <span className="text-[#6d6e6f]">{list.length}</span>
              </p>
              <div className="space-y-2">
                {list.map((t) => {
                  const team = TEAMS.find((x) => x.id === t.team)!;
                  const foreman = PERSONAS.find((p) => p.team === t.team)!;
                  const s = sched[t.id];
                  const open = Object.values(t.readiness).filter((r) => r?.state === "open").length;
                  const late = t.status !== "done" && s.ef < today;
                  const editable = canEdit(persona, t);
                  return (
                    <div
                      key={t.id}
                      draggable={editable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", t.id); // required by Firefox
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(t.id);
                      }}
                      onDragEnd={() => (setDragId(null), setOverCol(null))}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpen(t.id)}
                      onKeyDown={(e) => e.key === "Enter" && onOpen(t.id)}
                      className={`cursor-pointer rounded-xl border border-[#e8e6e3] bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-[#cfcbcb] ${dragId === t.id ? "opacity-40" : ""} ${editable ? "active:cursor-grabbing" : ""}`}
                    >
                      <div className="flex items-start gap-2">
                        <CheckCircle
                          done={t.status === "done"}
                          disabled={!editable}
                          onClick={() => changeTask(t.id, { status: t.status === "done" ? "planned" : "done" }, t.status === "done" ? "Marked incomplete" : "Marked complete")}
                        />
                        <p className={`text-sm leading-snug ${t.status === "done" ? "text-[#6d6e6f] line-through" : "text-[#1e1f21]"}`}>
                          {t.name} {t.section}
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: team.color }}>
                          {team.name}
                        </span>
                        {open > 0 && <span className="rounded-full bg-[#fde2e0] px-2 py-0.5 text-[11px] font-medium text-[#b42318]">⚠ {open} open</span>}
                        {t.delayDays > 0 && <span className="rounded-full bg-[#fde2e0] px-2 py-0.5 text-[11px] font-medium text-[#b42318]">+{t.delayDays}d</span>}
                      </div>
                      <div className="mt-2.5 flex items-center justify-between">
                        <Avatar id={foreman.id} name={foreman.name} size={22} />
                        <span className={`text-xs ${late ? "text-[#b42318]" : "text-[#6d6e6f]"}`}>{dayLabel(s.ef)}</span>
                      </div>
                      {editable && (
                        <select
                          aria-label="Move to column"
                          value={t.status}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => changeTask(t.id, { status: e.target.value as TaskStatus }, "Moved on board")}
                          className="mt-2 w-full rounded-md border border-[#e8e6e3] bg-white px-2 py-1 text-xs text-[#6d6e6f] lg:hidden"
                        >
                          {COLUMNS.map((c) => (
                            <option key={c.status} value={c.status}>
                              Move to: {c.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
                {list.length === 0 && <p className="px-2 py-4 text-center text-xs text-[#9ca0a5]">No tasks</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
