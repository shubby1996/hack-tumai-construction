"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { schedule } from "@/lib/engine";
import { dayLabel } from "@/lib/dates";
import { MILESTONES, PERSONAS, TEAMS } from "@/lib/seed";
import type { Task, TaskStatus } from "@/lib/types";
import { canEdit, statusTone } from "./TaskEditor";
import { Avatar, Badge, CheckCircle } from "./ui";

const GRID = "grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1fr)_150px_120px_110px_90px]";

/** Asana-style list: sections (teams) with task rows. `only` filters to one team (My tasks). */
export function TaskList({ onOpen, only }: { onOpen: (id: string) => void; only?: string }) {
  const { tasks, today, persona } = useStore();
  const changeTask = useStore((s) => s.changeTask);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const sched = schedule(tasks);
  const teams = only ? TEAMS.filter((t) => t.id === only) : TEAMS;

  const toggleDone = (t: Task) => {
    if (!canEdit(persona, t)) return;
    const next: TaskStatus = t.status === "done" ? "planned" : "done";
    changeTask(t.id, { status: next }, next === "done" ? "Marked complete" : "Marked incomplete");
  };

  return (
    <div className="rounded-2xl border border-[#e8e6e3] bg-white">
      <div className={`${GRID} hidden border-b border-[#e8e6e3] px-4 py-2 text-xs text-[#6d6e6f] sm:grid`}>
        <span>Task name</span>
        <span>Assignee</span>
        <span>Due date</span>
        <span>Status</span>
        <span>Readiness</span>
      </div>
      {teams.map((team) => {
        const list = tasks.filter((t) => t.team === team.id).sort((a, b) => sched[a.id].es - sched[b.id].es);
        const foreman = PERSONAS.find((p) => p.team === team.id)!;
        const isCollapsed = collapsed[team.id];
        return (
          <div key={team.id}>
            <button onClick={() => setCollapsed({ ...collapsed, [team.id]: !isCollapsed })} className="flex w-full items-center gap-2 px-4 pb-1 pt-4 text-left">
              <span className={`text-xs text-[#6d6e6f] transition ${isCollapsed ? "-rotate-90" : ""}`}>▼</span>
              <span className="text-[15px] font-medium text-[#1e1f21]">{team.name}</span>
              <span className="text-xs text-[#6d6e6f]">{team.company}</span>
              {persona === team.id && <Badge tone="amber">you</Badge>}
            </button>
            {!isCollapsed && (
              <ul>
                {list.map((t) => {
                  const s = sched[t.id];
                  const open = Object.values(t.readiness).filter((r) => r?.state === "open").length;
                  const late = t.status !== "done" && (t.status === "blocked" || s.ef < today);
                  const ms = MILESTONES.find((m) => m.id === t.milestone);
                  return (
                    <li key={t.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpen(t.id)}
                        onKeyDown={(e) => e.key === "Enter" && onOpen(t.id)}
                        className={`${GRID} cursor-pointer items-center gap-2 border-b border-[#f0efee] px-4 py-2 hover:bg-[#f9f8f8]`}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <CheckCircle done={t.status === "done"} disabled={!canEdit(persona, t)} onClick={() => toggleDone(t)} />
                          <span className="min-w-0">
                            <span className={`block truncate text-sm ${t.status === "done" ? "text-[#6d6e6f] line-through" : "text-[#1e1f21]"}`}>
                              {t.name} {t.section}
                              {ms && <span className="ml-1.5 text-[#c88a00]" title={ms.name}>◆</span>}
                            </span>
                            {/* compact meta on phones */}
                            <span className="text-xs text-[#6d6e6f] sm:hidden">
                              {dayLabel(s.es)} – {dayLabel(s.ef)} {open > 0 && <span className="text-[#b42318]">· ⚠ {open}</span>}
                            </span>
                          </span>
                        </span>
                        <span className="hidden items-center gap-2 text-sm text-[#1e1f21] sm:flex">
                          <Avatar id={foreman.id} name={foreman.name} />
                          <span className="truncate">{foreman.name.split(" ")[0]}</span>
                        </span>
                        <span className={`hidden text-sm sm:block ${late ? "text-[#b42318]" : t.status === "done" ? "text-[#0f6b3e]" : "text-[#1e1f21]"}`}>{dayLabel(s.ef)}</span>
                        <span className="justify-self-end sm:justify-self-start">
                          <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                        </span>
                        <span className="hidden text-xs sm:block">{open > 0 ? <span className="text-[#b42318]">⚠ {open} open</span> : <span className="text-[#0f6b3e]">✓ ready</span>}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      <div className="h-2" />
    </div>
  );
}
