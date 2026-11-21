"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { dayLabel } from "@/lib/dates";
import { SITE_DOCUMENTS, TEAMS } from "@/lib/seed";
import { parseCsv, rowsToTasks, templateCsv } from "@/lib/schedule-import";
import type { Contact, Task } from "@/lib/types";
import { Badge, Button, Card, Field, inputCls } from "./ui";

/** Initialise a site: project data, the schedule (MS Project / Excel export), documents and contacts. */
export function Setup({ toast }: { toast: (m: string) => void }) {
  const { project, contacts, tasks, persona } = useStore();
  const updateProject = useStore((s) => s.updateProject);
  const replaceTasks = useStore((s) => s.replaceTasks);
  const [preview, setPreview] = useState<{ file: string; tasks: Task[]; errors: string[]; warnings: string[] } | null>(null);
  const isSM = persona === "site-manager";

  async function readFile(f: File) {
    let rows: unknown[][];
    try {
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        rows = (await readSheet(f)) as unknown[][];
      } else rows = parseCsv(await f.text());
      setPreview({ file: f.name, ...rowsToTasks(rows as Parameters<typeof rowsToTasks>[0]) });
    } catch {
      setPreview({ file: f.name, tasks: [], errors: ["Could not read this file. Use .xlsx or .csv (export from MS Project: File → Save as → Excel)."], warnings: [] });
    }
  }

  function download() {
    const blob = new Blob(["﻿" + templateCsv(tasks)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "siteflow-schedule-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#e8e6e3] bg-white p-3 text-sm text-[#4b4c4e]">
        A site is set up once, before work starts: project data, the schedule from MS Project or Excel, the plans and the contract, and the people involved. Cats Track builds the
        first two-week plan from this; afterwards the site team works with it day to day.
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="1 · Project">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                ["name", "Project"],
                ["address", "Address"],
                ["contractor", "Contractor"],
                ["client", "Client (Bauherr)"],
                ["contractBasis", "Contract basis"],
                ["planStart", "Plan start (Monday)"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <input className={inputCls} value={project[k]} disabled={!isSM || k === "planStart"} onChange={(e) => updateProject({ [k]: e.target.value })} />
              </Field>
            ))}
          </div>
        </Card>

        <Card title="2 · Schedule" right={<Badge tone="green">{tasks.length} tasks</Badge>}>
          <p className="text-sm text-[#4b4c4e]">Import the schedule exported from MS Project or Excel. Columns: ID, Name, Team, Section, Start, Duration, Crew, Predecessors, Milestone.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className={`inline-flex min-h-10 items-center rounded-md px-3 py-2 text-sm font-medium sm:min-h-0 sm:py-1.5 ${isSM ? "cursor-pointer bg-[#ef6b62] text-white hover:bg-[#e2564d]" : "bg-stone-200 text-stone-400"}`}>
              Upload .xlsx / .csv
              <input
                type="file"
                accept=".xlsx,.csv,text/csv"
                className="hidden"
                disabled={!isSM}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) readFile(f);
                }}
              />
            </label>
            <Button onClick={download}>Download template (current plan)</Button>
          </div>
          {preview && (
            <div className="mt-3 rounded-lg bg-[#f9f8f8] p-3" data-testid="import-preview">
              <p className="text-sm font-medium text-[#1e1f21]">
                {preview.file}: {preview.tasks.length} task(s) read
              </p>
              {preview.errors.map((x) => (
                <p key={x} className="text-xs text-red-700">
                  ✕ {x}
                </p>
              ))}
              {preview.warnings.slice(0, 5).map((x) => (
                <p key={x} className="text-xs text-amber-800">
                  ⚠ {x}
                </p>
              ))}
              {preview.tasks.length > 0 && (
                <>
                  <ul className="mt-2 max-h-48 overflow-auto text-xs text-[#4b4c4e]">
                    {preview.tasks.map((t) => (
                      <li key={t.id}>
                        {t.id} · {t.name} {t.section} · {TEAMS.find((x) => x.id === t.team)?.name} · {dayLabel(t.plannedStart)} · {t.duration} d{t.predecessors.length ? ` · after ${t.predecessors.join(", ")}` : ""}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-[#6d6e6f]">Replaces the current plan. Readiness checks (material, drawings …) start as cleared and are set by the team.</p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="primary"
                      onClick={() => {
                        replaceTasks(preview.tasks, preview.file);
                        setPreview(null);
                        toast(`Plan initialised: ${preview.tasks.length} tasks`);
                      }}
                    >
                      Use this plan
                    </Button>
                    <Button variant="ghost" onClick={() => setPreview(null)}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>

        <Card title="3 · Documents">
          <ul className="divide-y divide-[#f0efed]">
            {SITE_DOCUMENTS.map((d) => (
              <li key={d.name} className="flex items-start gap-3 py-2">
                <span className="text-lg">{/\.xlsx$/.test(d.name) ? "📊" : "📄"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[#1e1f21]">{d.name}</span>
                  <span className="text-xs text-[#6d6e6f]">
                    {d.kind}
                    {d.pages ? ` · ${d.pages} pages` : ""} · {d.note}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[#6d6e6f]">Demo: documents are listed, not parsed. Next: the assistant reads the contract for notice periods and the specification for materials.</p>
        </Card>

        <Card title="4 · People" right={<span className="text-xs text-[#6d6e6f]">who gets messages, and how</span>}>
          <ul className="space-y-2">
            {contacts.map((c) => (
              <ContactRow key={c.id} c={c} disabled={!isSM} />
            ))}
          </ul>
          <p className="mt-2 text-xs text-[#6d6e6f]">
            People marked “no app” get ready-to-send WhatsApp/SMS/email drafts. In the demo you can still switch to a foreman profile to show a future subcontractor view.
          </p>
        </Card>
      </div>
    </div>
  );
}

function ContactRow({ c, disabled }: { c: Contact; disabled: boolean }) {
  const update = useStore((s) => s.updateContact);
  const [edit, setEdit] = useState(false);
  if (!edit)
    return (
      <li className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1">
          <span className="text-[#1e1f21]">{c.name}</span> <span className="text-xs text-[#6d6e6f]">· {c.role} · {c.company}</span>
          <span className="block text-xs text-[#9ca0a5]">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
        </span>
        <Badge tone={c.usesApp ? "green" : "stone"}>{c.usesApp ? "app" : "no app"}</Badge>
        {!disabled && (
          <button className="text-xs text-[#6d6e6f] underline" onClick={() => setEdit(true)}>
            edit
          </button>
        )}
      </li>
    );
  return (
    <li className="grid grid-cols-2 gap-2 rounded-lg bg-[#f9f8f8] p-2 text-sm">
      <input className={inputCls} value={c.name} onChange={(e) => update({ ...c, name: e.target.value })} aria-label="Name" />
      <input className={inputCls} value={c.phone ?? ""} placeholder="Phone (+49…)" onChange={(e) => update({ ...c, phone: e.target.value || undefined })} aria-label="Phone" />
      <input className={`${inputCls} col-span-2`} value={c.email ?? ""} placeholder="Email" onChange={(e) => update({ ...c, email: e.target.value || undefined })} aria-label="Email" />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={c.usesApp} onChange={(e) => update({ ...c, usesApp: e.target.checked })} /> uses the app
      </label>
      <Button onClick={() => setEdit(false)}>Done</Button>
    </li>
  );
}
