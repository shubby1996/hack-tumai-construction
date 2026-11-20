"use client";

import { useEffect, useState } from "react";
import { useSpeech } from "@/lib/useSpeech";
import { useStore } from "@/lib/store";
import { PERSONAS, SAMPLE_PHRASES } from "@/lib/seed";
import type { ExtractResult } from "@/lib/extract-rules";
import type { DiaryEntry, EntryFields, EntryType } from "@/lib/types";
import { Badge, Button, Card, Field, inputCls } from "./ui";

const TYPES: EntryType[] = ["stoppage", "delivery", "defect", "incident", "meeting", "attendance", "progress", "instruction", "note"];
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
  const { persona, tasks, today } = useStore();
  const addEntry = useStore((s) => s.addEntry);
  const [lang, setLang] = useState<"de-DE" | "en-US">("de-DE");
  const speech = useSpeech(lang);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ExtractResult | null>(null);
  const me = PERSONAS.find((p) => p.id === persona)!;

  // Live transcript into the text box while dictating.
  useEffect(() => {
    if (speech.listening || speech.finalText) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText([speech.finalText, speech.interim].filter(Boolean).join(" "));
    }
  }, [speech.finalText, speech.interim, speech.listening]);

  async function structure() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          speaker: `${me.name}, ${me.role}`,
          personaTeam: me.team,
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

  function save() {
    if (!draft) return;
    const entry: DiaryEntry = {
      id: `E-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      day: today,
      author: persona,
      type: draft.type,
      transcript: text,
      summary: draft.summary,
      fields: draft.fields,
      photos,
      engine: draft.engine,
    };
    addEntry(entry);
    onSaved(entry);
    setDraft(null);
    setText("");
    setPhotos([]);
  }

  const samples = SAMPLE_PHRASES.filter((s) => persona === "site-manager" || s.persona === persona || s.persona === "site-manager");
  const missingLabel = (m: string) => ({ startTime: "start time", responsibleParty: "who is responsible", estimatedDelayDays: "expected delay", taskId: "task", cause: "cause", location: "location", material: "material", quantity: "quantity" })[m] ?? m;

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
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
              disabled={!speech.supported}
              title={speech.supported ? "Dictate" : "Speech input needs Chrome, Edge or Safari"}
              className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-2xl shadow-md transition ${speech.listening ? "animate-pulse bg-red-600 text-white" : "bg-amber-500 text-stone-950 hover:bg-amber-400"} disabled:bg-stone-200 disabled:text-stone-400`}
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
            <label className="cursor-pointer rounded-lg bg-stone-100 px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-200">
              📷 Photo{photos.length ? ` (${photos.length})` : ""}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setPhotos([...photos, await downscale(f)]);
                  e.target.value = "";
                }}
              />
            </label>
            <Button variant="primary" onClick={structure} disabled={!text.trim() || busy}>
              {busy ? "Structuring…" : "Structure note →"}
            </Button>
            {!speech.supported && <span className="text-xs text-stone-500">Voice needs Chrome/Edge/Safari – typing works everywhere.</span>}
          </div>
          {photos.length > 0 && (
            <div className="flex gap-2">
              {photos.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={p} alt="" className="h-14 w-14 rounded-md object-cover" />
              ))}
            </div>
          )}
          <div className="border-t border-stone-100 pt-2">
            <p className="mb-1.5 text-xs text-stone-500">Demo phrases</p>
            <div className="flex flex-wrap gap-1.5">
              {samples.map((s) => (
                <button key={s.label} onClick={() => setText(s.text)} className="rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-600 hover:border-amber-400 hover:bg-amber-50">
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
            <Badge tone={draft.engine === "claude" ? "violet" : "stone"}>{draft.engine === "claude" ? "AI extraction" : "Rule-based extraction"}</Badge>
            <span className="text-xs text-stone-500">Check and correct before saving.</span>
          </div>
          <p className="rounded-lg bg-stone-50 p-2 text-xs italic text-stone-600">“{text}”</p>

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

          <div className="grid grid-cols-2 gap-3">
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
            <div className="col-span-2">
              <Field label="Summary">
                <input className={inputCls} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
              </Field>
            </div>
            {(["cause", "responsibleParty", "startTime", "estimatedDelayDays", "location", "material", "quantity"] as const)
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
          <div className="flex gap-2">
            <Button variant="primary" onClick={save}>
              Save to site diary
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
