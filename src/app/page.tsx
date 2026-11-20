"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { dayLabel } from "@/lib/dates";
import { PERSONAS, PROJECT } from "@/lib/seed";
import type { PersonaId } from "@/lib/types";
import { Today } from "@/components/Today";
import { Plan } from "@/components/Plan";
import { Diary } from "@/components/Diary";
import { Documents } from "@/components/Documents";
import { Badge } from "@/components/ui";

type Tab = "today" | "plan" | "diary" | "docs";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("today");
  const [msg, setMsg] = useState<string | null>(null);
  const [engine, setEngine] = useState<string>("…");
  const { persona, today, notices, entries, notifications } = useStore();
  const setPersona = useStore((s) => s.setPersona);
  const reset = useStore((s) => s.reset);

  useEffect(() => {
    // Render only on the client: state lives in localStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    fetch("/api/status")
      .then((r) => r.json())
      .then((s) => setEngine(s.extraction))
      .catch(() => setEngine("rules"));
  }, []);

  const toast = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  };

  if (!mounted) return <div className="p-8 text-stone-500">Loading…</div>;

  const me = PERSONAS.find((p) => p.id === persona)!;
  const unread = notifications.filter((n) => n.to.includes(persona) && !n.readBy.includes(persona)).length;
  const drafts = notices.filter((n) => n.status === "draft").length;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "today", label: "Today", count: unread || undefined },
    { id: "plan", label: "Plan" },
    { id: "diary", label: "Diary", count: entries.length || undefined },
    { id: "docs", label: "Documents", count: drafts || undefined },
  ];

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="sticky top-0 z-10 border-b border-stone-800 bg-stone-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 font-black text-stone-950">S</span>
            <div>
              <p className="text-sm font-semibold leading-tight">SiteFlow</p>
              <p className="text-xs leading-tight text-stone-400">{PROJECT.name}</p>
            </div>
          </div>
          <span className="rounded-md bg-stone-800 px-2 py-1 text-xs text-amber-300">📅 {dayLabel(today)} 2026</span>
          <span className="text-xs text-stone-400">AI: {engine === "claude" ? "Claude" : "rule-based (no API key)"}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-stone-400 sm:inline">Acting as</span>
            <select
              value={persona}
              onChange={(e) => setPersona(e.target.value as PersonaId)}
              className="rounded-lg border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-white"
            >
              {PERSONAS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} – {p.role}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (confirm("Reset the demo to its starting state?")) reset();
              }}
              className="rounded-lg px-2 py-1.5 text-xs text-stone-400 hover:bg-stone-800 hover:text-white"
            >
              Reset demo
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 px-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm font-medium ${tab === t.id ? "bg-stone-100 text-stone-900" : "text-stone-300 hover:text-white"}`}
            >
              {t.label}
              {t.count !== undefined && <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-stone-950">{t.count}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4">
        <p className="mb-3 text-sm text-stone-600">
          {me.name} · <span className="text-stone-500">{me.role}, {me.company}</span>{" "}
          {persona === "site-manager" ? <Badge tone="amber">approves re-plans & documents</Badge> : <Badge tone="blue">updates own tasks</Badge>}
        </p>
        {tab === "today" && <Today goDocs={() => setTab("docs")} toast={toast} />}
        {tab === "plan" && <Plan />}
        {tab === "diary" && <Diary />}
        {tab === "docs" && <Documents toast={toast} />}
        <p className="mt-8 text-center text-xs text-stone-400">
          Prototype · synthetic data · drafts are a drafting aid, not legal advice – the site manager reviews everything before sending. ·{" "}
          <a href="/platform.html" className="underline hover:text-stone-600">How the platform works</a>
        </p>
      </main>

      {msg && <div className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">{msg}</div>}
    </div>
  );
}
