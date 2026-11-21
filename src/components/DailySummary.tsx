"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { computeImpact, milestoneSlips, schedule, withDelay } from "@/lib/engine";
import { clock, dayLabel } from "@/lib/dates";
import { draftTagesbericht } from "@/lib/templates";
import type { ProposedChange, Task } from "@/lib/types";
import { Avatar, Badge, Button, Card } from "./ui";

/** "Today so far" for the site manager: what happened, what waits for him, what is due. */
export function DailySummary({ goDocs, goOutbox, goLogs, toast }: { goDocs: () => void; goOutbox: () => void; goLogs: () => void; toast: (m: string) => void }) {
  const s = useStore();
  const { entries, decisions, notices, messages, proposals, todos, today, tasks, pending, contacts } = s;
  const addNotice = useStore((x) => x.addNotice);
  const toggleTodo = useStore((x) => x.toggleTodo);
  const [ai, setAi] = useState<{ text?: string; busy?: boolean; note?: string }>({});

  const todays = entries.filter((e) => e.day === today);
  const authors = new Set(todays.map((e) => e.author));
  const problems = todays.filter((e) => ["stoppage", "defect", "incident"].includes(e.type));
  const dec = decisions.filter((d) => d.day === today);
  const openProposals = proposals.filter((p) => p.status === "pending");
  const draftNotices = notices.filter((n) => n.status === "draft");
  const toSend = messages.filter((m) => m.status === "draft");
  const due = todos.filter((t) => t.status === "open" && (t.dueDay === undefined ? true : t.dueDay <= today + 1)).slice(0, 6);
  const later = todos.filter((t) => t.status === "open" && t.dueDay !== undefined && t.dueDay > today + 1).length;
  const slips = milestoneSlips(tasks, schedule(tasks)).filter((m) => m.slip > 0);
  const waiting = openProposals.length + (pending ? 1 : 0) + draftNotices.length + toSend.length;
  const name = (id?: string) => contacts.find((c) => c.id === id)?.name ?? id ?? "—";

  // Deterministic summary, also the facts the model rephrases.
  const facts = [
    `${todays.length} log(s) today from ${authors.size} person(s).`,
    ...todays.slice(0, 12).map((e) => `- ${clock(e.createdAt)} ${e.type} by ${name(e.author)}${e.location ? ` at ${e.location}` : ""}: ${e.summary}`),
    openProposals.length ? `Waiting for decision: ${openProposals.map((p) => `${p.taskId} +${p.days} day(s) (${p.reason})`).join("; ")}.` : "",
    pending ? "A re-plan proposal after a stoppage is waiting for approval." : "",
    draftNotices.length ? `${draftNotices.length} draft notice(s) to review.` : "",
    toSend.length ? `${toSend.length} message(s) to subcontractors ready to send.` : "",
    slips.length ? `Milestones at risk: ${slips.map((m) => `${m.milestone.name} +${m.slip} d`).join(", ")}.` : "Milestones on track.",
    dec.length ? `Decisions today: ${dec.map((d) => d.text).join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  async function summarise() {
    setAi({ busy: true });
    try {
      const r = await fetch("/api/summary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ facts }) }).then((x) => x.json());
      if (r.summary) setAi({ text: r.summary, note: r.model });
      else setAi({ note: r.fallbackReason ? `AI summary unavailable (${r.fallbackReason})` : "No AI model configured – showing the plain summary." });
    } catch {
      setAi({ note: "AI summary unavailable." });
    }
  }

  return (
    <Card
      title={<span className="flex items-center gap-2">☀️ Today so far</span>}
      right={<span className="text-xs text-[#6d6e6f]">{dayLabel(today)}</span>}
      className="lg:col-span-5"
    >
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Stat n={todays.length} label="logs" sub={`from ${authors.size} people`} onClick={goLogs} />
        <Stat n={problems.length} label="problems" sub="stoppage · defect · incident" tone={problems.length ? "red" : undefined} onClick={goLogs} />
        <Stat n={waiting} label="waiting for you" sub="decide · review · send" tone={waiting ? "amber" : undefined} />
        <Stat n={slips.length} label="milestones at risk" sub={slips.length ? slips.map((m) => `+${m.slip}d`).join(" ") : "all on track"} tone={slips.length ? "red" : "green"} />
      </div>

      {openProposals.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#6d6e6f]">Plan changes reported – your decision</p>
          <ul className="space-y-2">
            {openProposals.map((p) => (
              <ProposalRow key={p.id} p={p} toast={toast} />
            ))}
          </ul>
        </div>
      )}

      {(pending || draftNotices.length > 0 || toSend.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {pending && <Badge tone="red">Re-plan proposal below ↓</Badge>}
          {draftNotices.length > 0 && (
            <Button onClick={goDocs}>
              📄 {draftNotices.length} draft notice{draftNotices.length > 1 ? "s" : ""} to review
            </Button>
          )}
          {toSend.length > 0 && (
            <Button onClick={goOutbox}>
              ✉ {toSend.length} message{toSend.length > 1 ? "s" : ""} to send
            </Button>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#6d6e6f]">Due today and tomorrow</p>
          {due.length === 0 && <p className="text-sm text-[#6d6e6f]">Nothing due.{later ? ` ${later} later.` : ""}</p>}
          <ul className="space-y-1">
            {due.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={false} onChange={() => toggleTodo(t.id)} aria-label="Done" />
                <span className="min-w-0 flex-1">
                  {t.kind === "remind" ? "⏰ " : ""}
                  {t.text}
                  <span className="text-xs text-[#6d6e6f]"> · {name(t.owner)}{t.dueDay !== undefined ? ` · ${t.dueDay < today ? "overdue" : t.dueDay === today ? "today" : dayLabel(t.dueDay)}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
          {due.length > 0 && later > 0 && <p className="mt-1 text-xs text-[#6d6e6f]">+ {later} later</p>}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#6d6e6f]">Latest logs</p>
          {todays.length === 0 && <p className="text-sm text-[#6d6e6f]">No logs yet today.</p>}
          <ul className="space-y-1.5">
            {todays.slice(0, 4).map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-sm">
                <Avatar id={e.author} name={name(e.author)} size={20} />
                <span className="min-w-0 flex-1">
                  <span className="text-xs text-[#6d6e6f]">{clock(e.createdAt)} </span>
                  {e.summary}
                  {e.location && <span className="text-xs text-[#6d6e6f]"> · 📍 {e.location}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-[#f9f8f8] p-3">
        {ai.text ? (
          <div className="whitespace-pre-line text-sm text-[#1e1f21]">{ai.text}</div>
        ) : (
          <p className="text-xs text-[#6d6e6f]">{ai.note ?? "Get a short written summary of the day, e.g. to forward to the project lead."}</p>
        )}
        {ai.text && ai.note && <p className="mt-1 text-[11px] text-violet-700">open-source model · {ai.note}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={summarise} disabled={ai.busy || !todays.length}>
            {ai.busy ? "Summarising…" : "✨ Summarise my day"}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              addNotice(draftTagesbericht({ day: today, tasks, sched: schedule(tasks), entries, decisions, notices }));
              toast("Daily report drafted – review it in Documents");
              goDocs();
            }}
          >
            Generate daily report
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Stat({ n, label, sub, tone, onClick }: { n: number; label: string; sub: string; tone?: "red" | "amber" | "green"; onClick?: () => void }) {
  const c = tone === "red" ? "bg-red-50 text-red-700" : tone === "amber" ? "bg-amber-50 text-amber-800" : tone === "green" ? "bg-emerald-50 text-emerald-700" : "bg-[#f5f4f3] text-[#1e1f21]";
  return (
    <button onClick={onClick} disabled={!onClick} className={`rounded-lg p-2 text-center ${c} ${onClick ? "hover:brightness-95" : "cursor-default"}`}>
      <p className="text-2xl font-bold">{n}</p>
      <p className="text-xs font-medium">{label}</p>
      <p className="truncate text-[11px] opacity-70">{sub}</p>
    </button>
  );
}

function ProposalRow({ p, toast }: { p: ProposedChange; toast: (m: string) => void }) {
  const { tasks, contacts } = useStore();
  const accept = useStore((s) => s.acceptProposal);
  const reject = useStore((s) => s.rejectProposal);
  const t = tasks.find((x) => x.id === p.taskId) as Task;
  if (!t) return null;
  // Preview the consequences before the site manager decides.
  const sched = schedule(tasks);
  const after = p.mode === "extend" ? withDelay(tasks, p.taskId, p.days) : tasks.map((x) => (x.id === p.taskId ? { ...x, plannedStart: Math.max(x.plannedStart, sched[x.id].es) + p.days } : x));
  const impact = computeImpact(tasks, after, p.taskId);
  const newSlips = impact.slipsAfter.filter((m) => m.slip > (impact.slipsBefore.find((b) => b.milestone.id === m.milestone.id)?.slip ?? 0));
  const who = contacts.find((c) => c.id === p.reportedBy)?.name ?? p.reportedBy;
  return (
    <li className="rounded-lg border border-amber-300 bg-amber-50/60 p-3" data-testid="proposal">
      <p className="text-sm text-[#1e1f21]">
        <b>
          {t.name} {t.section}
        </b>{" "}
        {p.mode === "extend" ? "takes" : "starts"} {p.days} day{p.days > 1 ? "s" : ""} {p.mode === "extend" ? "longer" : "later"}
      </p>
      <p className="mt-0.5 text-xs text-[#6d6e6f]">
        Reported by {who}: “{p.reason}”
      </p>
      <p className="mt-1 text-xs text-[#1e1f21]">
        Consequence: {impact.changedTaskIds.length ? `${impact.changedTaskIds.length} follow-on task(s) move (${impact.changedTaskIds.join(", ")})` : "no other task moves"}
        {newSlips.length ? <span className="text-red-700"> · ⚠ {newSlips.map((m) => `${m.milestone.name} +${m.slip} d`).join(", ")}</span> : " · milestones unaffected"}
      </p>
      <div className="mt-2 flex gap-2">
        <Button
          variant="primary"
          onClick={() => {
            accept(p.id);
            toast("Plan updated – messages to affected teams are ready");
          }}
        >
          Accept change
        </Button>
        <Button
          onClick={() => {
            reject(p.id);
            toast("Kept the plan as is");
          }}
        >
          Reject
        </Button>
      </div>
    </li>
  );
}
