"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { milestoneSlips, schedule } from "@/lib/engine";
import { dayShort } from "@/lib/dates";
import { MILESTONES, TEAMS } from "@/lib/seed";
import { TaskEditor } from "./TaskEditor";
import { Badge, Card } from "./ui";

const DAYS = Array.from({ length: 10 }, (_, i) => i);

export function Plan() {
  const { tasks, today, persona } = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const sched = schedule(tasks);
  const slips = milestoneSlips(tasks, sched);
  const selected = tasks.find((t) => t.id === sel);

  return (
    <div className="space-y-4">
      <Card
        title="Shared two-week plan"
        right={
          <div className="flex flex-wrap gap-2">
            {slips.map((s) => (
              <Badge key={s.milestone.id} tone={s.slip ? "red" : "green"}>
                ◆ {s.milestone.name}: {s.slip ? `+${s.slip} day` : "on track"}
              </Badge>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[220px_repeat(10,1fr)] border-b border-stone-200 pb-1 text-center text-xs text-stone-500">
              <div className="text-left">Task</div>
              {DAYS.map((d) => (
                <div key={d} className={d === today ? "rounded-t-md bg-amber-100 font-semibold text-amber-900" : ""}>
                  <div>{dayShort(d).wd}</div>
                  <div>{dayShort(d).date}</div>
                </div>
              ))}
            </div>
            {TEAMS.map((team) => (
              <div key={team.id} className="border-b border-stone-100 py-1">
                <div className="flex items-center gap-2 py-1 text-xs font-semibold text-stone-600">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: team.color }} />
                  {team.name} · {team.company}
                  {persona === team.id && <Badge tone="amber">you</Badge>}
                </div>
                {tasks
                  .filter((t) => t.team === team.id)
                  .sort((a, b) => sched[a.id].es - sched[b.id].es)
                  .map((t) => {
                    const s = sched[t.id];
                    const open = Object.values(t.readiness).filter((r) => r?.state === "open").length;
                    const base = t.duration;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setSel(sel === t.id ? null : t.id)}
                        className={`grid w-full grid-cols-[220px_repeat(10,1fr)] items-center rounded-md text-left hover:bg-stone-50 ${sel === t.id ? "bg-amber-50" : ""}`}
                      >
                        <div className="flex items-center gap-1.5 truncate py-1 pr-2 text-sm text-stone-800">
                          <span className="text-xs text-stone-400">{t.id}</span>
                          <span className="truncate">
                            {t.name} {t.section}
                          </span>
                          {open > 0 && <span title="Open readiness items" className="text-xs text-red-600">⚠{open}</span>}
                          {t.milestone && <span className="text-amber-600">◆</span>}
                        </div>
                        {DAYS.map((d) => {
                          const inBar = d >= s.es && d <= s.ef;
                          const isDelay = inBar && d > s.es + base - 1 && t.delayDays > 0;
                          const first = d === s.es;
                          const lastD = d === s.ef;
                          return (
                            <div key={d} className={`relative h-7 ${d === today ? "bg-amber-50" : ""}`}>
                              {inBar && (
                                <div
                                  className={`absolute inset-y-1 ${first ? "left-1 rounded-l-md" : "left-0"} ${lastD ? "right-1 rounded-r-md" : "right-0"} ${t.status === "done" ? "opacity-40" : ""}`}
                                  style={{
                                    background: isDelay ? "repeating-linear-gradient(45deg,#fecaca,#fecaca 4px,#fee2e2 4px,#fee2e2 8px)" : team.color,
                                    boxShadow:
                                      t.status === "blocked"
                                        ? ["inset 0 2px 0 #dc2626", "inset 0 -2px 0 #dc2626", first ? "inset 2px 0 0 #dc2626" : "", lastD ? "inset -2px 0 0 #dc2626" : ""].filter(Boolean).join(",")
                                        : undefined,
                                  }}
                                />
                              )}
                              {first && inBar && <span className="absolute inset-y-0 left-2 flex items-center text-[10px] font-medium text-white">{t.crew}👷</span>}
                            </div>
                          );
                        })}
                      </button>
                    );
                  })}
              </div>
            ))}
            <div className="grid grid-cols-[220px_repeat(10,1fr)] pt-2 text-center text-xs">
              <div className="text-left font-semibold text-stone-600">Milestone targets</div>
              {DAYS.map((d) => (
                <div key={d}>
                  {MILESTONES.filter((m) => m.targetDay === d).map((m) => (
                    <span key={m.id} title={m.name} className="font-bold text-amber-600">
                      ◆ {m.id}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-stone-500">Click a task to see readiness and change it. Striped red = delay. Red outline = blocked. ⚠ = open readiness items.</p>
      </Card>
      {selected && (
        <Card title="Task details">
          <TaskEditor key={selected.id + selected.plannedStart + selected.duration + selected.status} task={selected} />
        </Card>
      )}
    </div>
  );
}
