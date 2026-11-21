"use client";

import { useEffect, useState } from "react";
import { useSpeech } from "@/lib/useSpeech";
import { useStore } from "@/lib/store";
import { PERSONAS, SAMPLE_PHRASES } from "@/lib/seed";
import type { DraftStep, ExtractResult } from "@/lib/extract-rules";
import type { DiaryEntry, EntryFields, EntryType, NextStepKind } from "@/lib/types";
import { clock, dayLabel } from "@/lib/dates";
import { Badge, Button, Card, Field, inputCls } from "./ui";

const newEntryId = () => `E-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
const nowIso = () => new Date().toISOString();

interface Photo {
  url: string;
  status: "analysing" | "done" | "off" | "error";
  note?: string; // caption + findings from the vision model
  reason?: string; // why analysis failed
}

const TYPES: EntryType[] = ["stoppage", "delivery", "defect", "incident", "meeting", "attendance", "progress", "instruction", "note"];
const KINDS: { id: NextStepKind; label: string }[] = [
  { id: "task", label: "To-do" },
  { id: "notify", label: "Inform" },
  { id: "contact", label: "Contact" },
  { id: "remind", label: "Remind me" },
  { id: "other", label: "Other" },
];
const PARTIES = ["Client (Bauherr)", "Own company", "Supplier", "Weather", "Other subcontractor"];

async function downscale(file: File, max = 900): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((r) => ((img.onload = r), (img.src = url)));
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL("image/jpeg", 0.7);
}

export function Capture({ onSaved }: { onSaved: (entry: DiaryEntry) => void }) {
  const { persona, tasks, today, contacts } = useStore();
  const addEntry = useStore((s) => s.addEntry);
  const [lang, setLang] = useState<"de-DE" | "en-US">("de-DE");
  const speech = useSpeech(lang);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ExtractResult | null>(null);
  const [usedVoice, setUsedVoice] = useState(false);
  const me = PERSONAS.find((p) => p.id === persona)!;

  // Live transcript into the text box while dictating.
  useEffect(() => {
    if (speech.listening || speech.finalText) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText([speech.finalText, speech.interim].filter(Boolean).join(" "));
    }
  }, [speech.finalText, speech.interim, speech.listening]);

  const photoNotes = photos.map((p) => p.note).filter((n): n is string => !!n);

  async function addPhoto(file: File) {
    const url = await downscale(file);
    setPhotos((ps) => [...ps, { url, status: "analysing" }]);
    try {
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: url, context: text }),
      });
      const a = await res.json();
      const note =
        a.engine === "open" && a.caption
          ? [a.caption, ...(a.findings ?? []).map((f: string) => `Finding: ${f}`), a.textInImage ? `Text in photo: ${a.textInImage}` : ""].filter(Boolean).join(" ")
          : undefined;
      setPhotos((ps) => ps.map((p) => (p.url === url ? { ...p, status: a.engine === "open" ? (note ? "done" : "error") : a.error ? "error" : "off", note, reason: a.error } : p)));
    } catch {
      setPhotos((ps) => ps.map((p) => (p.url === url ? { ...p, status: "error" } : p)));
    }
  }

  async function structure() {
    if (!text.trim() && !photoNotes.length) return;
    setBusy(true);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          photoNotes,
          speaker: `${me.name}, ${me.role}`,
          personaTeam: me.team,
          today,
          tasks: tasks.filter((t) => t.status !== "done").map(({ id, name, team, section }) => ({ id, name, team, section })),
        }),
      });
      setDraft(await res.json());
    } finally {
      setBusy(false);
    }
  }

  function setField(k: keyof EntryFields, v: string | number | undefined) {
    if (!draft) return;
    const missing = draft.missing.filter((m) => !(m === k && v !== undefined && v !== ""));
    setDraft({ ...draft, fields: { ...draft.fields, [k]: v }, missing });
  }

  const steps = draft?.nextSteps ?? [];
  function setSteps(next: DraftStep[]) {
    if (draft) setDraft({ ...draft, nextSteps: next });
  }
  function setLocation(v: string) {
    if (!draft) return;
    setDraft({ ...draft, location: v || undefined, missing: v ? draft.missing.filter((m) => m !== "location") : draft.missing });
  }

  function save() {
    if (!draft) return;
    const entry: DiaryEntry = {
      id: newEntryId(),
      createdAt: nowIso(),
      day: today,
      author: persona,
      type: draft.type,
      transcript: text || "(photo only)",
      summary: draft.summary,
      fields: draft.fields,
      photos: photos.map((p) => p.url),
      photoNotes,
      location: draft.location,
      state: draft.state ?? draft.summary,
      nextSteps: steps.filter((st) => st.text.trim()).map((st, i) => ({ ...st, id: `${Date.now().toString(36)}-${i}` })),
      source: usedVoice ? "voice" : text.trim() ? "text" : "photo",
      engine: draft.engine,
      model: draft.model,
    };
    addEntry(entry);
    onSaved(entry);
    setDraft(null);
    setText("");
    setPhotos([]);
    setUsedVoice(false);
  }

  const samples = SAMPLE_PHRASES.filter((s) => persona === "site-manager" || s.persona === persona || s.persona === "site-manager");
  const missingLabel = (m: string) => ({ startTime: "start time", responsibleParty: "who is responsible", estimatedDelayDays: "expected delay", taskId: "task", cause: "cause", location: "where exactly", material: "material", quantity: "quantity" })[m] ?? m;

  return (
    <Card
      title="Capture a site situation"
      right={
        <div className="flex rounded-lg bg-stone-100 p-0.5 text-xs">
          {(["de-DE", "en-US"] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)} className={`rounded-md px-2 py-1 ${lang === l ? "bg-white shadow-sm font-semibold" : "text-stone-500"}`}>
              {l === "de-DE" ? "DE" : "EN"}
            </button>
          ))}
        </div>
      }
    >
      {!draft && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <button
              onClick={() => {
                if (speech.listening) speech.stop();
                else {
                  setUsedVoice(true);
                  speech.start();
                }
              }}
              disabled={!speech.supported}
              title={speech.supported ? "Dictate" : "Speech input needs Chrome, Edge or Safari"}
              className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-2xl shadow-md transition active:scale-95 ${speech.listening ? "animate-pulse bg-red-600 text-white" : "bg-[#ef6b62] text-white hover:bg-[#e2564d]"} disabled:bg-stone-200 disabled:text-stone-400`}
            >
              {speech.listening ? "■" : "🎙"}
            </button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder={lang === "de-DE" ? "Diktieren oder tippen, z. B. „Bagger steht seit 10 Uhr, Leitungsplan fehlt“" : "Dictate or type, e.g. “Excavator idle since 10 am, utility plan missing”"}
              className={`${inputCls} min-h-16`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: "📷 Camera", capture: true },
              { label: "🖼 Photo", capture: false },
            ].map((b) => (
              <label key={b.label} className={`${b.capture ? "sm:hidden" : ""} flex min-h-10 cursor-pointer items-center rounded-lg bg-stone-100 px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-200 sm:min-h-0 sm:py-1.5`}>
                {b.label}
                {!b.capture && photos.length ? ` (${photos.length})` : ""}
                <input
                  type="file"
                  accept="image/*"
                  {...(b.capture ? { capture: "environment" as const } : {})}
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) await addPhoto(f);
                  }}
                />
              </label>
            ))}
            <Button variant="primary" onClick={structure} disabled={(!text.trim() && !photoNotes.length) || busy || photos.some((p) => p.status === "analysing")}>
              {busy ? "Structuring…" : "Structure note →"}
            </Button>
            {!speech.supported && <span className="text-xs text-stone-500">Voice needs Chrome/Edge/Safari – typing works everywhere.</span>}
          </div>
          {photos.length > 0 && (
            <ul className="space-y-2">
              {photos.map((p, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg bg-stone-50 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
                  <div className="text-xs">
                    {p.status === "analysing" && <span className="text-amber-700">👁 Looking at the photo…</span>}
                    {p.status === "done" && (
                      <>
                        <span className="font-medium text-violet-700">👁 Vision model: </span>
                        <span className="text-stone-700">{p.note}</span>
                      </>
                    )}
                    {p.status === "off" && <span className="text-stone-500">Photo attached. Photo understanding needs an open vision model (set LLM_BASE_URL).</span>}
                    {p.status === "error" && <span className="text-red-600">Could not analyse this photo{p.reason ? ` (${p.reason})` : ""} – it is still attached.</span>}
                    <button className="ml-2 text-stone-400 underline" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>
                      remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-stone-100 pt-2">
            <p className="mb-1.5 text-xs text-stone-500">Demo phrases</p>
            <div className="flex flex-wrap gap-1.5">
              {samples.map((s) => (
                <button key={s.label} onClick={() => setText(s.text)} className="rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-600 hover:border-[#ef6b62] hover:bg-[#fdf3f2]">
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {draft && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={draft.engine === "rules" ? "stone" : "violet"}>
              {draft.engine === "open" ? `Open-source model · ${draft.model ?? ""}` : draft.engine === "claude" ? "Claude extraction" : "Rule-based extraction"}
            </Badge>
            <span className="text-xs text-stone-500">Check and correct before saving.</span>
            {draft.fallbackReason && <span className="w-full text-xs text-amber-700">AI model not used ({draft.fallbackReason}) – the built-in rules filled this in.</span>}
          </div>
          <p className="rounded-lg bg-stone-50 p-2 text-xs italic text-stone-600">“{text || "(photo only)"}”</p>
          {photoNotes.length > 0 && <p className="rounded-lg bg-violet-50 p-2 text-xs text-violet-800">👁 {photoNotes.join(" · ")}</p>}

          {draft.followUpQuestion && draft.missing.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">🤖 {draft.followUpQuestion}</p>
              <p className="mt-0.5 text-xs text-amber-800">Missing: {draft.missing.map(missingLabel).join(", ")}</p>
              {draft.missing.includes("responsibleParty") && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PARTIES.map((p) => (
                    <button key={p} onClick={() => setField("responsibleParty", p)} className="rounded-full bg-white px-2.5 py-1 text-xs shadow-sm hover:bg-amber-100">
                      {p}
                    </button>
                  ))}
                </div>
              )}
              {draft.missing.includes("estimatedDelayDays") && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-amber-900">Expected delay:</span>
                  {[1, 2, 3].map((d) => (
                    <button key={d} onClick={() => setField("estimatedDelayDays", d)} className="rounded-full bg-white px-2.5 py-1 text-xs shadow-sm hover:bg-amber-100">
                      {d} day{d > 1 ? "s" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-stone-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Log</p>
              <span className="text-xs text-stone-500">
                🕒 {dayLabel(today)}, {clock(nowIso())} · {me.name}
                {photos.length ? ` · 📷 ${photos.length}` : ""}
              </span>
            </div>
            <Field label="Location">
              <input
                className={`${inputCls} ${draft.missing.includes("location") ? "border-amber-400 bg-amber-50" : ""}`}
                placeholder="Building, floor, room or section"
                value={draft.location ?? ""}
                onChange={(e) => setLocation(e.target.value)}
              />
            </Field>
            <Field label="Current state">
              <textarea className={`${inputCls} min-h-14`} rows={2} value={draft.state ?? draft.summary} onChange={(e) => setDraft({ ...draft, state: e.target.value })} />
            </Field>
            <div>
              <p className="mb-1 text-xs font-medium text-stone-600">Next steps</p>
              <ul className="space-y-2">
                {steps.map((st, i) => (
                  <li key={i} className="rounded-lg bg-stone-50 p-2" data-testid="next-step">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select className={`${inputCls} w-auto! py-1 text-xs`} value={st.kind} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, kind: e.target.value as NextStepKind, source: "user" } : x)))}>
                        {KINDS.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                      <select className={`${inputCls} w-auto! py-1 text-xs`} value={st.who ?? ""} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, who: e.target.value || undefined, source: "user" } : x)))}>
                        <option value="">Who?</option>
                        {contacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} · {c.role.split(" (")[0]}
                          </option>
                        ))}
                      </select>
                      <select className={`${inputCls} w-auto! py-1 text-xs`} value={st.dueDay ?? ""} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, dueDay: e.target.value === "" ? undefined : Number(e.target.value), source: "user" } : x)))}>
                        <option value="">No date</option>
                        {st.dueDay !== undefined && st.dueDay > today + 9 && <option value={st.dueDay}>{dayLabel(st.dueDay)}</option>}
                        {Array.from({ length: 10 }, (_, d) => today + d).map((d) => (
                          <option key={d} value={d}>
                            {d === today ? "Today" : dayLabel(d)}
                          </option>
                        ))}
                      </select>
                      {st.source === "user" && <Badge tone="amber">your instruction</Badge>}
                      <button className="ml-auto text-xs text-stone-400 hover:text-red-600" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label="Remove step">
                        ✕
                      </button>
                    </div>
                    <input className={`${inputCls} mt-1.5`} value={st.text} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                  </li>
                ))}
              </ul>
              <button className="mt-1.5 text-xs font-medium text-[#ef6b62] hover:underline" onClick={() => setSteps([...steps, { kind: "task", text: "", who: "site-manager", source: "user" }])}>
                + Add next step
              </button>
            </div>
            {(() => {
              const ext = steps.filter((st) => (st.kind === "notify" || st.kind === "contact" || st.kind === "task") && contacts.find((c) => c.id === st.who && !c.usesApp));
              const t = tasks.find((x) => x.id === draft.fields.taskId);
              const delay = Number(draft.fields.estimatedDelayDays ?? 0);
              return (
                <div className="space-y-1 text-xs">
                  {ext.length > 0 && <p className="text-stone-600">✉ {ext.length} ready-to-send message(s) will be prepared for {Array.from(new Set(ext.map((st) => contacts.find((c) => c.id === st.who)!.name))).join(", ")}.</p>}
                  {t && delay > 0 && draft.type !== "stoppage" && (
                    <p className="text-stone-600">
                      📅 Proposes moving <b>{t.name} {t.section}</b> by {delay} day(s) – the site manager accepts before the plan changes.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>

          <details className="rounded-xl border border-stone-200 p-3" open={draft.missing.some((m) => m !== "location") || draft.type === "stoppage"}>
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-stone-500">Classification & details</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Type">
              <select className={inputCls} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as EntryType })}>
                {TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Task">
              <select className={inputCls} value={draft.fields.taskId ?? ""} onChange={(e) => setField("taskId", e.target.value || undefined)}>
                <option value="">—</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id} · {t.name} {t.section}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Summary">
                <input className={inputCls} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
              </Field>
            </div>
            {(["cause", "responsibleParty", "startTime", "estimatedDelayDays", "material", "quantity"] as const)
              .filter((k) => draft.fields[k] !== undefined || draft.missing.includes(k) || (draft.type === "stoppage" && ["cause", "responsibleParty", "startTime", "estimatedDelayDays"].includes(k)))
              .map((k) => (
                <Field key={k} label={missingLabel(k).replace(/^\w/, (c) => c.toUpperCase())}>
                  <input
                    className={`${inputCls} ${draft.missing.includes(k) ? "border-amber-400 bg-amber-50" : ""}`}
                    type={k === "estimatedDelayDays" ? "number" : "text"}
                    min={k === "estimatedDelayDays" ? 1 : undefined}
                    value={draft.fields[k] ?? ""}
                    onChange={(e) => setField(k, k === "estimatedDelayDays" ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value)}
                  />
                </Field>
              ))}
          </div>
          </details>
          <div className="sticky bottom-16 flex gap-2 bg-white/95 py-2 sm:static sm:bottom-auto sm:py-0">
            <Button variant="primary" onClick={save} className="flex-1 sm:flex-none">
              Save log
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
