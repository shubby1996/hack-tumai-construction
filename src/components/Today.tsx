"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { computeImpact, milestoneSlips, preventiveScan, schedule, withDelay } from "@/lib/engine";
import { clock, dayLabel } from "@/lib/dates";
import { PERSONAS } from "@/lib/seed";
import { draftAnforderung, draftBedenken, draftBehinderung, draftMaengel, draftMehrkosten } from "@/lib/templates";
import type { DiaryEntry, Notice } from "@/lib/types";
import { Capture } from "./Capture";
import { ReplanPanel } from "./Replan";
import { TaskEditor } from "./TaskEditor";
import { Badge, Button, Card } from "./ui";

export function Today({ goDocs, toast }: { goDocs: () => void; toast: (m: string) => void }) {
  const [last, setLast] = useState<DiaryEntry | null>(null);
  const persona = useStore((s) => s.persona);
  const startReplan = useStore((s) => s.startReplan);
  const isSM = persona === "site-manager";

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <Capture
          onSaved={(e) => {
            setLast(e);
            if (e.type === "stoppage" && e.fields.taskId) startReplan(e.id);
            toast("Saved to the site diary");
          }}
        />
        <ReplanPanel />
        {last && <NextSteps entry={last} goDocs={goDocs} toast={toast} onClose={() => setLast(null)} />}
        {!isSM && <MyTasks />}
      </div>
      <div className="space-y-4 lg:col-span-2">
        <Alerts goDocs={goDocs} toast={toast} />
        <Notifications />
        <Kpis />
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

function Notifications() {
  const { notifications, persona } = useStore();
  const markRead = useStore((s) => s.markRead);
  const mine = notifications.filter((n) => n.to.includes(persona)).slice(0, 8);
  const unread = mine.filter((n) => !n.readBy.includes(persona)).length;
  return (
    <Card title={<span className="flex items-center gap-2">🔔 Notifications {unread > 0 && <Badge tone="red">{unread} new</Badge>}</span>} right={unread > 0 && <Button variant="ghost" onClick={markRead}>Mark read</Button>}>
      {mine.length === 0 && <p className="text-sm text-stone-500">No notifications yet.</p>}
      <ul className="space-y-2">
        {mine.map((n) => (
          <li key={n.id} className={`rounded-lg p-2.5 text-sm ${n.readBy.includes(persona) ? "bg-stone-50 text-stone-500" : "bg-blue-50 text-stone-800"}`}>
            <span className="mr-1 text-xs text-stone-400">{clock(n.createdAt)}</span>
            {n.text}
          </li>
        ))}
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

function MyTasks() {
  const { tasks, persona } = useStore();
  const sched = schedule(tasks);
  const mine = tasks.filter((t) => t.team === persona).sort((a, b) => sched[a.id].es - sched[b.id].es);
  const [open, setOpen] = useState<string | null>(null);
  const me = PERSONAS.find((p) => p.id === persona);
  return (
    <Card title={`My tasks · ${me?.company}`}>
      <ul className="divide-y divide-stone-100">
        {mine.map((t) => (
          <li key={t.id} className="py-2">
            <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
              <span className="text-sm font-medium text-stone-900">
                {t.name} {t.section}
              </span>
              <span className="text-xs text-stone-500">
                {dayLabel(sched[t.id].es)} – {dayLabel(sched[t.id].ef)} <Badge tone={t.status === "blocked" ? "red" : t.status === "done" ? "green" : "stone"}>{t.status}</Badge>
              </span>
            </button>
            {open === t.id && (
              <div className="mt-3">
                <TaskEditor key={t.id} task={t} onDone={() => setOpen(null)} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
