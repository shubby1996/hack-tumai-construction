"use client";

import { useStore } from "@/lib/store";
import { milestoneSlips, schedule } from "@/lib/engine";
import { dayShort } from "@/lib/dates";
import { MILESTONES, TEAMS } from "@/lib/seed";
import { Badge } from "./ui";

const DAYS = Array.from({ length: 10 }, (_, i) => i);

/** Two-week timeline (Gantt). Clicking a bar opens the task panel. */
export function Timeline({ onOpen }: { onOpen: (id: string) => void }) {
  const { tasks, today, persona } = useStore();
  const sched = schedule(tasks);
  const slips = milestoneSlips(tasks, sched);

  return (
    <div className="rounded-2xl border border-[#e8e6e3] bg-white">
      <div className="flex flex-wrap gap-2 px-4 pt-4">
        {slips.map((s) => (
          <Badge key={s.milestone.id} tone={s.slip ? "red" : "green"}>
            ◆ {s.milestone.name}: {s.slip ? `+${s.slip} day` : "on track"}
          </Badge>
        ))}
      </div>
      <div className="overflow-x-auto px-4 pb-4 pt-3">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[220px_repeat(10,1fr)] border-b border-[#e8e6e3] pb-1 text-center text-xs text-[#6d6e6f]">
            <div className="text-left">Task</div>
            {DAYS.map((d) => (
              <div key={d} className={d === today ? "rounded-t-md bg-[#fde2e0] font-semibold text-[#b42318]" : ""}>
                <div>{dayShort(d).wd}</div>
                <div>{dayShort(d).date}</div>
              </div>
            ))}
          </div>
          {TEAMS.map((team) => (
            <div key={team.id} className="border-b border-[#f0efee] py-1">
              <div className="flex items-center gap-2 py-1 text-xs font-medium text-[#1e1f21]">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: team.color }} />
                {team.name} <span className="font-normal text-[#6d6e6f]">· {team.company}</span>
                {persona === team.id && <Badge tone="amber">you</Badge>}
              </div>
              {tasks
                .filter((t) => t.team === team.id)
                .sort((a, b) => sched[a.id].es - sched[b.id].es)
                .map((t) => {
                  const s = sched[t.id];
                  const open = Object.values(t.readiness).filter((r) => r?.state === "open").length;
                  return (
                    <button key={t.id} onClick={() => onOpen(t.id)} className="grid w-full grid-cols-[220px_repeat(10,1fr)] items-center rounded-md text-left hover:bg-[#f9f8f8]">
                      <div className="flex items-center gap-1.5 truncate py-1 pr-2 text-sm text-[#1e1f21]">
                        <span className={`truncate ${t.status === "done" ? "text-[#6d6e6f] line-through" : ""}`}>
                          {t.name} {t.section}
                        </span>
                        {open > 0 && <span className="text-xs text-[#b42318]">⚠{open}</span>}
                        {t.milestone && <span className="text-[#c88a00]">◆</span>}
                      </div>
                      {DAYS.map((d) => {
                        const inBar = d >= s.es && d <= s.ef;
                        const isDelay = inBar && d > s.es + t.duration - 1 && t.delayDays > 0;
                        const first = d === s.es;
                        const last = d === s.ef;
                        return (
                          <div key={d} className={`relative h-7 ${d === today ? "bg-[#fdf3f2]" : ""}`}>
                            {inBar && (
                              <div
                                className={`absolute inset-y-1 ${first ? "left-1 rounded-l-full" : "left-0"} ${last ? "right-1 rounded-r-full" : "right-0"} ${t.status === "done" ? "opacity-40" : ""}`}
                                style={{
                                  background: isDelay ? "repeating-linear-gradient(45deg,#fbc5c0,#fbc5c0 4px,#fde2e0 4px,#fde2e0 8px)" : team.color,
                                  boxShadow:
                                    t.status === "blocked"
                                      ? ["inset 0 2px 0 #e8384f", "inset 0 -2px 0 #e8384f", first ? "inset 2px 0 0 #e8384f" : "", last ? "inset -2px 0 0 #e8384f" : ""].filter(Boolean).join(",")
                                      : undefined,
                                }}
                              />
                            )}
                            {first && inBar && <span className="absolute inset-y-0 left-2.5 flex items-center text-[10px] font-medium text-white">{t.crew}👷</span>}
                          </div>
                        );
                      })}
                    </button>
                  );
                })}
            </div>
          ))}
          <div className="grid grid-cols-[220px_repeat(10,1fr)] pt-2 text-center text-xs">
            <div className="text-left font-medium text-[#6d6e6f]">Milestone targets</div>
            {DAYS.map((d) => (
              <div key={d}>
                {MILESTONES.filter((m) => m.targetDay === d).map((m) => (
                  <span key={m.id} title={m.name} className="font-bold text-[#c88a00]">
                    ◆ {m.id}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-[#6d6e6f]">Tap a bar to open the task. Striped = delay. Red edge = blocked. ⚠ = open readiness items.</p>
      </div>
    </div>
  );
}
