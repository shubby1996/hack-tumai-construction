"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { dayLabel } from "@/lib/dates";
import { SAMPLE_MINUTES } from "@/lib/seed";
import type { MinutesItem } from "@/lib/minutes";
import type { DiaryEntry } from "@/lib/types";
import { Badge, Button, Card, inputCls } from "./ui";

const KIND_LABEL = { task: "To-do", notify: "Inform", contact: "Contact", remind: "Reminder", other: "Other" };

/** Paste meeting minutes → one log per agenda item, each with who / what / by when. */
export function MinutesImport({ onDone, toast }: { onDone: () => void; toast: (m: string) => void }) {
  const { tasks, today, persona, contacts } = useStore();
  const addEntries = useStore((s) => s.addEntries);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ items: MinutesItem[]; engine: string; model?: string; fallbackReason?: string } | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const name = (id?: string) => contacts.find((c) => c.id === id)?.name ?? "—";

  async function analyse() {
    setBusy(true);
    try {
      const r = await fetch("/api/minutes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, today, tasks: tasks.map(({ id, name, team, section }) => ({ id, name, team, section })) }),
      }).then((x) => x.json());
      setRes(r);
      setKeep((r.items ?? []).map(() => true));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!res) return;
    const stamp = Date.now().toString(36);
    const entries: DiaryEntry[] = res.items
      .filter((_, i) => keep[i])
      .map((it, i) => ({
        id: `E-${stamp}-m${i}`,
        createdAt: new Date().toISOString(),
        day: today,
        author: persona,
        type: it.type,
        transcript: it.text,
        summary: it.summary,
        fields: it.taskId ? { taskId: it.taskId } : {},
        photos: [],
        location: it.location,
        state: it.state,
        nextSteps: it.nextSteps.map((st, j) => ({ ...st, id: `${stamp}-${i}-${j}` })),
        source: "minutes",
        engine: res.engine === "open" ? "open" : "rules",
        model: res.model,
      }));
    addEntries(entries);
    toast(`${entries.length} log(s) saved from the minutes`);
    onDone();
  }

  return (
    <Card title="Import meeting minutes" right={<Button variant="ghost" onClick={onDone}>✕</Button>}>
      {!res ? (
        <div className="space-y-2">
          <textarea className={`${inputCls} min-h-40 text-sm`} placeholder="Paste the minutes of the site meeting (Baubesprechung) here" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={analyse} disabled={!text.trim() || busy}>
              {busy ? "Reading…" : "Split into logs →"}
            </Button>
            <Button variant="ghost" onClick={() => setText(SAMPLE_MINUTES)}>
              Use sample minutes
            </Button>
            <label className="inline-flex cursor-pointer items-center rounded-md px-3 py-1.5 text-sm text-[#4b4c4e] hover:bg-[#f5f4f3]">
              Upload .txt
              <input type="file" accept=".txt,.md,text/plain" className="hidden" onChange={async (e) => setText(await (e.target.files?.[0]?.text() ?? Promise.resolve("")))} />
            </label>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-[#6d6e6f]">
            <Badge tone={res.engine === "open" ? "violet" : "stone"}>{res.engine === "open" ? `open-source model · ${res.model}` : "rule-based"}</Badge>{" "}
            {res.fallbackReason ? `AI not used (${res.fallbackReason}). ` : ""}
            {res.items.length} item(s) found – untick what you don’t want to save.
          </p>
          <ul className="space-y-2">
            {res.items.map((it, i) => (
              <li key={i} className={`rounded-lg border p-2 ${keep[i] ? "border-[#e8e6e3]" : "border-dashed border-[#e8e6e3] opacity-50"}`} data-testid="minutes-item">
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={keep[i] ?? false} onChange={() => setKeep(keep.map((k, j) => (j === i ? !k : k)))} />
                  <span className="min-w-0 flex-1 text-sm">
                    {it.text}
                    <span className="mt-1 flex flex-wrap gap-1.5 text-xs text-[#6d6e6f]">
                      <Badge>{it.type}</Badge>
                      {it.taskId && <span>🔗 {it.taskId}</span>}
                      {it.location && <span>📍 {it.location}</span>}
                      {it.nextSteps.map((st, j) => (
                        <span key={j}>
                          → {KIND_LABEL[st.kind]}: {name(st.who)}
                          {st.dueDay !== undefined ? ` · by ${dayLabel(st.dueDay)}` : ""}
                        </span>
                      ))}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button variant="primary" onClick={save} disabled={!keep.some(Boolean)}>
              Save {keep.filter(Boolean).length} log(s)
            </Button>
            <Button variant="ghost" onClick={() => setRes(null)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
