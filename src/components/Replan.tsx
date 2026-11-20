"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { dayLabel } from "@/lib/dates";
import { teamName } from "@/lib/engine";
import { Badge, Button, Card } from "./ui";

export function ReplanPanel() {
  const { pending, tasks, persona } = useStore();
  const approve = useStore((s) => s.approveReplan);
  const reject = useStore((s) => s.rejectReplan);
  const ref = useRef<HTMLDivElement>(null);
  const pid = pending?.proposal.id;
  useEffect(() => {
    // Bring a new proposal into view (on phones it would otherwise be below the fold).
    if (pid) setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [pid]);
  if (!pending) return null;
  const p = pending.proposal;
  const trig = tasks.find((t) => t.id === p.triggerTaskId);
  const name = (id: string) => {
    const t = tasks.find((x) => x.id === id);
    return t ? `${t.name} ${t.section}` : id;
  };
  const slipBefore = p.impact.slipsAfter.filter((s) => s.slip > 0);
  const slipAfter = p.slipsAfterReplan.filter((s) => s.slip > 0);
  const isSM = persona === "site-manager";

  return (
    <div ref={ref} className="scroll-mt-28">
    <Card
      className="border-red-200 ring-1 ring-red-100"
      title={<span className="flex items-center gap-2">⚡ Re-plan proposal <Badge tone="red">reactive</Badge></span>}
      right={<span className="text-xs text-stone-500">after stoppage on {trig ? `${trig.name} ${trig.section}` : p.triggerTaskId}</span>}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-red-50 p-3">
          <p className="text-xs text-red-700">Without action</p>
          <p className="text-lg font-semibold text-red-800">{slipBefore.length ? `+${Math.max(...slipBefore.map((s) => s.slip))} day slip` : "No slip"}</p>
          <p className="text-xs text-red-700">{slipBefore.map((s) => s.milestone.name).join(", ") || "milestones hold"}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-3">
          <p className="text-xs text-emerald-700">With re-plan</p>
          <p className="text-lg font-semibold text-emerald-800">{slipAfter.length ? `+${Math.max(...slipAfter.map((s) => s.slip))} day slip` : "Milestones hold"}</p>
          <p className="text-xs text-emerald-700">{p.actions.length} action{p.actions.length === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-lg bg-amber-50 p-3">
          <p className="text-xs text-amber-700">Idle crew-hours avoided</p>
          <p className="text-lg font-semibold text-amber-800">≈ {p.idleHoursSaved} h</p>
          <p className="text-xs text-amber-700">no overtime used</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Knock-on effect of the delay</p>
        <p className="mt-1 text-sm text-stone-700">
          {p.impact.changedTaskIds.length ? (
            <>
              {p.impact.changedTaskIds.map(name).join(", ")} move · affects {p.impact.affectedTeams.map(teamName).join(", ")}
            </>
          ) : (
            "No other task moves."
          )}
        </p>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Proposed actions</p>
        <ol className="mt-2 space-y-2">
          {p.actions.map((a, i) => (
            <li key={i} className="flex gap-3 rounded-lg border border-stone-200 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-900 text-xs font-bold text-white">{i + 1}</span>
              <div className="text-sm">
                <p className="font-medium text-stone-900">
                  {a.kind === "crash" ? "Add crew" : "Pull forward"}: {name(a.taskId)}{" "}
                  <span className="font-normal text-stone-500">
                    {a.kind === "pull-forward" ? `${dayLabel(a.fromDay)} → ${dayLabel(a.toDay)}` : `${dayLabel(a.toDay)}, ${a.newDuration} day`}
                  </span>
                </p>
                <p className="text-stone-600">{a.reason}</p>
              </div>
            </li>
          ))}
          {!p.actions.length && <li className="text-sm text-stone-500">No useful re-plan found – the delay will be recorded as is.</li>}
        </ol>
      </div>

      <ul className="mt-4 list-disc space-y-0.5 pl-5 text-xs text-stone-500">
        {p.explanation.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="success" onClick={approve} disabled={!isSM}>
          ✓ Approve re-plan
        </Button>
        <Button variant="secondary" onClick={reject} disabled={!isSM}>
          Reject (record delay only)
        </Button>
        {!isSM && <span className="text-xs text-stone-500">Waiting for the site manager to approve.</span>}
      </div>
    </Card>
    </div>
  );
}
