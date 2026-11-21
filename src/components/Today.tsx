"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { computeImpact, milestoneSlips, preventiveScan, schedule, withDelay } from "@/lib/engine";
import { dayLabel } from "@/lib/dates";
import { PERSONAS } from "@/lib/seed";
import { draftAnforderung, draftBedenken, draftBehinderung, draftMaengel, draftMehrkosten } from "@/lib/templates";
import type { DiaryEntry, Notice } from "@/lib/types";
import { Capture } from "./Capture";
import { DailySummary } from "./DailySummary";
import { ReplanPanel } from "./Replan";
import { canEdit, statusTone } from "./TaskEditor";
import { Avatar, Badge, Button, Card, CheckCircle } from "./ui";

export function Today({ goDocs, goOutbox, goLogs, toast, onOpen }: { goDocs: () => void; goOutbox: () => void; goLogs: () => void; toast: (m: string) => void; onOpen: (id: string) => void }) {
  const [last, setLast] = useState<DiaryEntry | null>(null);
  const { persona, today } = useStore();
  const startReplan = useStore((s) => s.startReplan);
  const me = PERSONAS.find((p) => p.id === persona)!;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <div className="mb-6 text-center">
        <p className="text-sm text-[#6d6e6f]">{dayLabel(today)} 2026</p>
        <h1 className="mt-1 text-2xl font-normal text-[#1e1f21] sm:text-3xl">
          {greet}, {me.name.split(" ")[0]}
        </h1>
      </div>
      {persona === "site-manager" && (
        <div className="mb-4">
          <DailySummary goDocs={goDocs} goOutbox={goOutbox} goLogs={goLogs} toast={toast} />
        </div>
      )}
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <Capture
          onSaved={(e) => {
            setLast(e);
            if (e.type === "stoppage" && e.fields.taskId) startReplan(e.id);
            const delay = Number(e.fields.estimatedDelayDays ?? 0);
            const ext = useStore.getState().messages.filter((m) => m.entryId === e.id).length;
            toast(
              e.type !== "stoppage" && e.fields.taskId && delay > 0
                ? persona === "site-manager"
                  ? "Log saved – plan change waiting for your decision above"
                  : "Log saved – plan change sent to the site manager"
                : ext
                  ? `Log saved – ${ext} message(s) ready to send`
                  : "Log saved"
            );
          }}
        />
        <ReplanPanel />
        {last && <NextSteps entry={last} goDocs={goDocs} toast={toast} onClose={() => setLast(null)} />}
      </div>
      <div className="space-y-4 lg:col-span-2">
        <MyTasks onOpen={onOpen} />
        <Alerts goDocs={goDocs} toast={toast} />
        <Kpis />
      </div>
    </div>
    </div>
  );
}

function NextSteps({ entry, goDocs, toast, onClose }: { entry: DiaryEntry; goDocs: () => void; toast: (m: string) => void; onClose: () => void }) {
  const { tasks, today } = useStore();
  const addNotice = useStore((s) => s.addNotice);
  const task = tasks.find((t) => t.id === entry.fields.taskId);
  const make = (n: Notice) => {
    addNotice(n);
    toast("Draft created – review it in Documents");
    goDocs();
  };
  const options: { label: string; build: () => Notice }[] = [];
  if (entry.type === "stoppage") {
    options.push({
      label: "Draft obstruction notice (Behinderungsanzeige)",
      build: () => {
        const base = tasks.map((t) => (t.id === task?.id ? { ...t, delayDays: Math.max(0, t.delayDays - Number(entry.fields.estimatedDelayDays ?? 1)) } : t));
        const impact = task ? computeImpact(base, withDelay(base, task.id, Number(entry.fields.estimatedDelayDays ?? 1)), task.id) : undefined;
        return draftBehinderung(entry, task, impact, today, tasks);
      },
    });
  }
  if (entry.type === "defect" || entry.type === "delivery") options.push({ label: entry.type === "delivery" ? "Draft complaint to supplier (Mängelrüge)" : "Draft defect notice (Mängelanzeige)", build: () => draftMaengel(entry, task, today) });
  if (entry.type === "instruction") options.push({ label: "Draft additional cost notice (Mehrkostenanzeige)", build: () => draftMehrkosten(entry, task, today) });
  if (["stoppage", "instruction", "defect", "delivery"].includes(entry.type)) options.push({ label: "Draft notice of concern (Bedenkenanzeige)", build: () => draftBedenken(entry, task, today) });

  return (
    <Card title="Suggested next steps" right={<Button variant="ghost" onClick={onClose}>✕</Button>}>
      <p className="text-sm text-stone-700">
        <Badge tone="blue">{entry.type}</Badge> {entry.summary}
      </p>
      {options.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((o) => (
            <Button key={o.label} variant={o === options[0] ? "primary" : "secondary"} onClick={() => make(o.build())}>
              {o.label}
            </Button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-stone-500">No correspondence needed. It will appear in today’s report.</p>
      )}
    </Card>
  );
}

function Alerts({ goDocs, toast }: { goDocs: () => void; toast: (m: string) => void }) {
  const { tasks, today, persona } = useStore();
  const addNotice = useStore((s) => s.addNotice);
  const clearBlocker = useStore((s) => s.clearBlocker);
  const all = preventiveScan(tasks, today);
  const mine = persona === "site-manager" ? all : all.filter((a) => tasks.find((t) => t.id === a.taskId)?.team === persona);
  return (
    <Card title={<span className="flex items-center gap-2">🛡 Blockers to clear <Badge tone="green">preventive</Badge></span>} right={<span className="text-xs text-stone-500">next 5 working days</span>}>
      {mine.length === 0 && <p className="text-sm text-stone-500">Nothing blocks the next five days. 👍</p>}
      <ul className="space-y-3">
        {mine.map((a) => {
          const t = tasks.find((x) => x.id === a.taskId)!;
          const daysLeft = a.dueDay - today;
          return (
            <li key={`${a.taskId}-${a.key}`} className="rounded-lg border border-stone-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-stone-900">
                  {t.name} {t.section} <span className="font-normal text-stone-500">· starts {dayLabel(a.startDay)}</span>
                </p>
                <Badge tone={daysLeft <= 1 ? "red" : "amber"}>{daysLeft <= 0 ? "due today" : `due in ${daysLeft}d`}</Badge>
              </div>
              <p className="mt-1 text-sm text-stone-600">{a.note}</p>
              <p className="mt-0.5 text-xs text-stone-500">
                Owner: {a.owner}
                {a.slack <= 0 ? " · on the critical path to a milestone" : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {!/site manager/i.test(a.owner) && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      addNotice(draftAnforderung(a, t, today));
                      toast("Request drafted – review it in Documents");
                      goDocs();
                    }}
                  >
                    Draft request
                  </Button>
                )}
                <Button onClick={() => (clearBlocker(a.taskId, a.key), toast("Blocker cleared and logged"))}>Mark cleared</Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Kpis() {
  const { decisions, today, tasks } = useStore();
  const d = decisions.filter((x) => x.day === today);
  const prev = d.filter((x) => x.kind === "preventive").length;
  const reac = d.filter((x) => x.kind === "reactive").length;
  const share = prev + reac ? Math.round((prev / (prev + reac)) * 100) : 0;
  const slips = milestoneSlips(tasks, schedule(tasks));
  return (
    <Card title="Today at a glance">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-emerald-50 p-2">
          <p className="text-2xl font-bold text-emerald-700">{prev}</p>
          <p className="text-xs text-emerald-700">preventive</p>
        </div>
        <div className="rounded-lg bg-red-50 p-2">
          <p className="text-2xl font-bold text-red-700">{reac}</p>
          <p className="text-xs text-red-700">reactive</p>
        </div>
        <div className="rounded-lg bg-stone-100 p-2">
          <p className="text-2xl font-bold text-stone-800">{share}%</p>
          <p className="text-xs text-stone-600">preventive share</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1">
        {slips.map((s) => (
          <li key={s.milestone.id} className="flex items-center justify-between text-sm">
            <span className="text-stone-700">◆ {s.milestone.name}</span>
            <Badge tone={s.slip ? "red" : "green"}>{s.slip ? `+${s.slip} day` : `on track · ${dayLabel(s.milestone.targetDay)}`}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MyTasks({ onOpen }: { onOpen: (id: string) => void }) {
  const { tasks, persona, today } = useStore();
  const changeTask = useStore((s) => s.changeTask);
  const sched = schedule(tasks);
  const isSM = persona === "site-manager";
  // Foremen: their own open tasks. Site manager: everything active in the next 2 working days.
  const list = tasks
    .filter((t) => t.status !== "done")
    .filter((t) => (isSM ? sched[t.id].es <= today + 2 && sched[t.id].ef >= today : t.team === persona))
    .sort((a, b) => sched[a.id].es - sched[b.id].es)
    .slice(0, 6);
  return (
    <Card title={isSM ? "On site now and next" : "My tasks"} right={<span className="text-xs text-[#6d6e6f]">{list.length} open</span>}>
      <ul className="-mx-2">
        {list.map((t) => {
          const foreman = PERSONAS.find((p) => p.team === t.team)!;
          const late = t.status === "blocked" || sched[t.id].ef < today;
          return (
            <li key={t.id}>
              <div role="button" tabIndex={0} onClick={() => onOpen(t.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(t.id)} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 hover:bg-[#f9f8f8]">
                <CheckCircle done={false} disabled={!canEdit(persona, t)} onClick={() => changeTask(t.id, { status: "done" }, "Marked complete")} />
                <span className="min-w-0 flex-1 truncate text-sm text-[#1e1f21]">
                  {t.name} {t.section}
                </span>
                {t.status !== "planned" && <Badge tone={statusTone(t.status)}>{t.status}</Badge>}
                <span className={`shrink-0 text-xs ${late ? "text-[#b42318]" : "text-[#6d6e6f]"}`}>{dayLabel(sched[t.id].ef)}</span>
                {isSM && <Avatar id={foreman.id} name={foreman.name} size={20} />}
              </div>
            </li>
          );
        })}
        {list.length === 0 && <li className="px-2 py-3 text-sm text-[#6d6e6f]">Nothing open. 🎉</li>}
      </ul>
    </Card>
  );
}
