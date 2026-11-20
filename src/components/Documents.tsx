"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { schedule } from "@/lib/engine";
import { clock } from "@/lib/dates";
import { exportDocx, exportPdf } from "@/lib/export";
import { draftTagesbericht, NOTICE_LABEL } from "@/lib/templates";
import { Badge, Button, Card } from "./ui";

export function Documents({ toast }: { toast: (m: string) => void }) {
  const { notices, selectedNoticeId, persona, tasks, entries, decisions, today } = useStore();
  const select = useStore((s) => s.selectNotice);
  const update = useStore((s) => s.updateNotice);
  const approve = useStore((s) => s.approveNotice);
  const addNotice = useStore((s) => s.addNotice);
  const sel = notices.find((n) => n.id === selectedNoticeId) ?? notices[0];
  const isSM = persona === "site-manager";
  const editorRef = useRef<HTMLDivElement>(null);
  const pick = (id: string) => {
    select(id);
    // On phones the editor sits below the list: bring it into view.
    if (window.innerWidth < 1024) setTimeout(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  useEffect(() => {
    if (selectedNoticeId && window.innerWidth < 1024) editorRef.current?.scrollIntoView({ block: "start" });
    // run once on open, when a draft was just created elsewhere
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card
        title="Drafts & documents"
        className="lg:col-span-2"
        right={
          <Button
            variant="primary"
            onClick={() => {
              addNotice(draftTagesbericht({ day: today, tasks, sched: schedule(tasks), entries, decisions, notices }));
              toast("Daily report drafted");
            }}
          >
            + Daily report
          </Button>
        }
      >
        {notices.length === 0 && <p className="text-sm text-stone-500">No drafts yet. Save a stoppage, defect or delivery, or draft a request from a blocker alert.</p>}
        <ul className="space-y-2">
          {notices.map((n) => (
            <li key={n.id}>
              <button onClick={() => pick(n.id)} className={`w-full rounded-lg border p-3 text-left ${sel?.id === n.id ? "border-[#4573d2] bg-[#f5f8fe]" : "border-[#e8e6e3] hover:bg-[#f9f8f8]"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-stone-900">{n.title}</span>
                  <Badge tone={n.status === "approved" ? "green" : "amber"}>{n.status}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-stone-500">
                  {NOTICE_LABEL[n.type]} · to {n.addressee} · {clock(n.createdAt)}
                </p>
                <div className="mt-1">
                  <Badge tone={n.mode === "preventive" ? "green" : n.mode === "reactive" ? "red" : "stone"}>{n.mode}</Badge>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <div ref={editorRef} className="scroll-mt-28 lg:col-span-3">
      <Card
        title={sel ? sel.title : "Preview"}
        right={
          sel && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => exportPdf(sel)}>⬇ PDF</Button>
              <Button onClick={() => exportDocx(sel)}>⬇ Word</Button>
              {sel.status === "draft" && (
                <Button variant="success" disabled={!isSM} onClick={() => (approve(sel.id), toast("Approved and logged"))} title={isSM ? "" : "Only the site manager can approve"}>
                  ✓ Approve
                </Button>
              )}
            </div>
          )
        }
      >
        {!sel && <p className="text-sm text-stone-500">Select a draft.</p>}
        {sel && (
          <>
            {sel.status === "draft" ? (
              <p className="mb-2 text-xs text-amber-700">Draft – edit freely. {isSM ? "Approve when it is correct." : "Only the site manager can approve and release."} [Placeholders] mark facts that were not recorded.</p>
            ) : (
              <p className="mb-2 text-xs text-emerald-700">Approved – locked for editing.</p>
            )}
            <textarea
              value={sel.body}
              readOnly={sel.status !== "draft"}
              onChange={(e) => update(sel.id, e.target.value)}
              className="h-[60vh] w-full rounded-lg border border-stone-300 bg-stone-50 p-3 font-mono text-[13px] leading-relaxed text-stone-900 focus:border-[#4573d2] focus:outline-none sm:p-4 lg:h-[560px]"
            />
          </>
        )}
      </Card>
      </div>
    </div>
  );
}
