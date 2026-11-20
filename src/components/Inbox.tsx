"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { clock } from "@/lib/dates";
import { PERSONAS } from "@/lib/seed";
import { Avatar, Button } from "./ui";

const KIND_LABEL = { change: "Task changed", replan: "Re-plan", alert: "Update", notice: "Document" } as const;

/** Asana-style inbox: notifications for the current persona. */
export function Inbox() {
  const { notifications, persona } = useStore();
  const markRead = useStore((s) => s.markRead);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const mine = notifications.filter((n) => n.to.includes(persona));
  const shown = filter === "unread" ? mine.filter((n) => !n.readBy.includes(persona)) : mine;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center gap-2">
        {(["all", "unread"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-sm ${filter === f ? "bg-[#1e1f21] text-white" : "text-[#6d6e6f] hover:bg-[#efedec]"}`}>
            {f === "all" ? "Activity" : "Unread"}
          </button>
        ))}
        <Button variant="ghost" className="ml-auto" onClick={markRead}>
          Mark all as read
        </Button>
      </div>
      <div className="rounded-2xl border border-[#e8e6e3] bg-white">
        {shown.length === 0 && <p className="p-8 text-center text-sm text-[#6d6e6f]">You’re all caught up. 🎉</p>}
        <ul>
          {shown.map((n) => {
            const unread = !n.readBy.includes(persona);
            const author = PERSONAS.find((p) => p.id === n.from);
            return (
              <li key={n.id} className={`flex gap-3 border-b border-[#f0efee] px-4 py-3 last:border-0 ${unread ? "bg-[#f5f8fe]" : ""}`}>
                <Avatar id={author?.id ?? "x"} name={author?.name ?? "Site Flow"} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-[#6d6e6f]">
                    {author && <span className="font-medium text-[#1e1f21]">{author.name} · </span>}
                    {KIND_LABEL[n.kind]} · {clock(n.createdAt)} {unread && <span className="ml-1 inline-block h-2 w-2 rounded-full bg-[#4573d2]" />}
                  </p>
                  <p className="mt-0.5 text-sm text-[#1e1f21]">{n.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
