"use client";

import { useStore } from "@/lib/store";
import { clock, dayLabel } from "@/lib/dates";
import { PERSONAS } from "@/lib/seed";
import { Badge, Card } from "./ui";

const who = (id: string) => PERSONAS.find((p) => p.id === id)?.name ?? id;

export function Diary() {
  const { entries, decisions, changes, tasks } = useStore();
  const taskName = (id?: string) => {
    const t = tasks.find((x) => x.id === id);
    return t ? `${t.name} ${t.section}` : undefined;
  };
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card title={`Site diary · ${entries.length} entries`} className="lg:col-span-3">
        {entries.length === 0 && <p className="text-sm text-stone-500">No entries yet. Capture a situation on the Today tab.</p>}
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="rounded-lg border border-stone-200 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                <span>
                  {dayLabel(e.day)}, {clock(e.createdAt)}
                </span>
                <Badge tone={e.type === "stoppage" ? "red" : e.type === "defect" ? "amber" : "blue"}>{e.type}</Badge>
                <span>by {who(e.author)}</span>
                <Badge tone={e.engine === "rules" ? "stone" : "violet"}>{e.engine === "open" ? `open model${e.model ? ` · ${e.model}` : ""}` : e.engine}</Badge>
              </div>
              <p className="mt-1 text-sm font-medium text-stone-900">{e.summary}</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-stone-600">
                {taskName(e.fields.taskId) && (
                  <>
                    <dt className="text-stone-400">Task</dt>
                    <dd>{taskName(e.fields.taskId)}</dd>
                  </>
                )}
                {Object.entries(e.fields)
                  .filter(([k, v]) => k !== "taskId" && v !== undefined && v !== "")
                  .map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-stone-400">{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
              </dl>
              <p className="mt-1 text-xs italic text-stone-400">“{e.transcript}”</p>
              {e.photoNotes && e.photoNotes.length > 0 && <p className="mt-1 rounded-md bg-violet-50 p-1.5 text-xs text-violet-800">👁 {e.photoNotes.join(" · ")}</p>}
              {e.photos.length > 0 && (
                <div className="mt-2 flex gap-2">
                  {e.photos.map((p, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={p} alt="" className="h-16 w-16 rounded-md object-cover" />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <div className="space-y-4 lg:col-span-2">
        <Card title="Decision log">
          {decisions.length === 0 && <p className="text-sm text-stone-500">No decisions yet.</p>}
          <ul className="space-y-2">
            {decisions.map((d) => (
              <li key={d.id} className="text-sm">
                <Badge tone={d.kind === "preventive" ? "green" : d.kind === "reactive" ? "red" : "stone"}>{d.kind}</Badge>{" "}
                <span className="text-xs text-stone-400">{clock(d.createdAt)}</span> <span className="text-stone-700">{d.text}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Change log (audit trail)">
          {changes.length === 0 && <p className="text-sm text-stone-500">No task changes yet.</p>}
          <ul className="space-y-2 text-sm">
            {changes.map((c) => (
              <li key={c.id} className="rounded-lg bg-stone-50 p-2">
                <p className="text-stone-800">
                  <span className="text-xs text-stone-400">{clock(c.createdAt)}</span> {who(c.by)} changed {taskName(c.taskId)}
                </p>
                <p className="text-xs text-stone-500">
                  {JSON.stringify(c.before)} → {JSON.stringify(c.after)}
                  {c.reason ? ` · “${c.reason}”` : ""}
                </p>
                <p className="text-xs text-stone-500">
                  Moved: {c.affectedTaskIds.join(", ") || "none"} · notified: {c.notified.map(who).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
