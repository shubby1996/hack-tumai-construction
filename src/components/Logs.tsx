"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { clock, dayLabel } from "@/lib/dates";
import type { DiaryEntry } from "@/lib/types";
import { MinutesImport } from "./MinutesImport";
import { Avatar, Badge, Button, Card, inputCls } from "./ui";

const KIND_LABEL = { task: "To-do", notify: "Inform", contact: "Contact", remind: "Reminder", other: "Other" };
const SOURCE_ICON = { voice: "🎙", text: "⌨", photo: "📷", minutes: "📝" };

/** Every log from everyone, newest first, with filters. Decision and change logs alongside. */
export function Logs({ toast }: { toast: (m: string) => void }) {
  const { entries, decisions, changes, tasks, contacts, todos } = useStore();
  const [q, setQ] = useState("");
  const [day, setDay] = useState<string>("all");
  const [author, setAuthor] = useState("all");
  const [type, setType] = useState("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [minutes, setMinutes] = useState(false);
  const name = (id?: string) => contacts.find((c) => c.id === id)?.name ?? id ?? "—";
  const taskName = (id?: string) => {
    const t = tasks.find((x) => x.id === id);
    return t ? `${t.name} ${t.section}` : undefined;
  };
  const days = Array.from(new Set(entries.map((e) => e.day))).sort((a, b) => b - a);
  const authors = Array.from(new Set(entries.map((e) => e.author)));
  const types = Array.from(new Set(entries.map((e) => e.type)));
  const openFor = (e: DiaryEntry) => todos.filter((t) => t.entryId === e.id && t.status === "open").length;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (day === "all" || e.day === Number(day)) &&
        (author === "all" || e.author === author) &&
        (type === "all" || e.type === type) &&
        (!openOnly || todos.some((t) => t.entryId === e.id && t.status === "open")) &&
        (!needle || [e.summary, e.location, e.state, e.transcript, taskName(e.fields.taskId)].some((x) => x?.toLowerCase().includes(needle)))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, q, day, author, type, openOnly, todos]);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        {minutes && <MinutesImport onDone={() => setMinutes(false)} toast={toast} />}
        <Card
          title={`Logs · ${list.length}${list.length !== entries.length ? ` of ${entries.length}` : ""}`}
          right={
            !minutes && (
              <Button onClick={() => setMinutes(true)} className="text-xs">
                📝 Import meeting minutes
              </Button>
            )
          }
        >
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input className={`${inputCls} col-span-2 sm:col-span-4`} placeholder="Search text, location or task…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className={inputCls} value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day">
              <option value="all">All days</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d)}
                </option>
              ))}
            </select>
            <select className={inputCls} value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Author">
              <option value="all">Everyone</option>
              {authors.map((a) => (
                <option key={a} value={a}>
                  {name(a)}
                </option>
              ))}
            </select>
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
              <option value="all">All types</option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-[#4b4c4e]">
              <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> open steps only
            </label>
          </div>
          {entries.length === 0 && <p className="text-sm text-[#6d6e6f]">No logs yet. Capture a situation on Home, or import meeting minutes.</p>}
          <ul className="space-y-3">
            {list.map((e) => (
              <li key={e.id} className="rounded-lg border border-[#e8e6e3] p-3" data-testid="log">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#6d6e6f]">
                  <Avatar id={e.author} name={name(e.author)} size={20} />
                  <span className="font-medium text-[#1e1f21]">{name(e.author)}</span>
                  <span>
                    {dayLabel(e.day)}, {clock(e.createdAt)}
                  </span>
                  {e.source && <span title={e.source}>{SOURCE_ICON[e.source]}</span>}
                  <Badge tone={e.type === "stoppage" ? "red" : e.type === "defect" || e.type === "incident" ? "amber" : "blue"}>{e.type}</Badge>
                  {openFor(e) > 0 && <Badge tone="amber">{openFor(e)} open</Badge>}
                </div>
                <p className="mt-1.5 text-sm font-medium text-[#1e1f21]">{e.summary}</p>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  {e.location && (
                    <>
                      <dt className="text-[#9ca0a5]">Location</dt>
                      <dd>📍 {e.location}</dd>
                    </>
                  )}
                  {e.state && e.state !== e.summary && (
                    <>
                      <dt className="text-[#9ca0a5]">State</dt>
                      <dd>{e.state}</dd>
                    </>
                  )}
                  {taskName(e.fields.taskId) && (
                    <>
                      <dt className="text-[#9ca0a5]">Task</dt>
                      <dd>{taskName(e.fields.taskId)}</dd>
                    </>
                  )}
                </dl>
                {e.nextSteps && e.nextSteps.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {e.nextSteps.map((st) => (
                      <li key={st.id} className="text-[#4b4c4e]">
                        → <b>{KIND_LABEL[st.kind]}</b> {st.text} · {name(st.who)}
                        {st.dueDay !== undefined ? ` · ${dayLabel(st.dueDay)}` : ""}
                        {st.source === "user" ? " · as instructed" : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {e.photos.length > 0 && (
                  <div className="mt-2 flex gap-2">
                    {e.photos.map((p, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={p} alt="" className="h-16 w-16 rounded-md object-cover" />
                    ))}
                  </div>
                )}
                <details className="mt-1.5 text-xs text-[#6d6e6f]">
                  <summary className="cursor-pointer">Original words & details</summary>
                  <p className="mt-1 italic">“{e.transcript}”</p>
                  {e.photoNotes && e.photoNotes.length > 0 && <p className="mt-1 rounded-md bg-violet-50 p-1.5 text-violet-800">👁 {e.photoNotes.join(" · ")}</p>}
                  <p className="mt-1">
                    {Object.entries(e.fields)
                      .filter(([k, v]) => k !== "taskId" && v !== undefined && v !== "")
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")}
                  </p>
                  <p className="mt-1">Structured by: {e.engine === "open" ? `open model${e.model ? ` · ${e.model}` : ""}` : e.engine}</p>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="space-y-4 lg:col-span-2">
        <Card title="Decision log">
          {decisions.length === 0 && <p className="text-sm text-[#6d6e6f]">No decisions yet.</p>}
          <ul className="space-y-2">
            {decisions.map((d) => (
              <li key={d.id} className="text-sm">
                <Badge tone={d.kind === "preventive" ? "green" : d.kind === "reactive" ? "red" : "stone"}>{d.kind}</Badge> <span className="text-xs text-[#9ca0a5]">{clock(d.createdAt)}</span>{" "}
                <span className="text-[#4b4c4e]">{d.text}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Change log (audit trail)">
          {changes.length === 0 && <p className="text-sm text-[#6d6e6f]">No task changes yet.</p>}
          <ul className="space-y-2 text-sm">
            {changes.map((c) => (
              <li key={c.id} className="rounded-lg bg-[#f9f8f8] p-2">
                <p className="text-[#1e1f21]">
                  <span className="text-xs text-[#9ca0a5]">{clock(c.createdAt)}</span> {name(c.by)} changed {taskName(c.taskId)}
                </p>
                <p className="text-xs text-[#6d6e6f]">
                  {JSON.stringify(c.before)} → {JSON.stringify(c.after)}
                  {c.reason ? ` · “${c.reason}”` : ""}
                </p>
                <p className="text-xs text-[#6d6e6f]">
                  Moved: {c.affectedTaskIds.join(", ") || "none"} · notified: {c.notified.map(name).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
