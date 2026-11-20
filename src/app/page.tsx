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
import { PhoneQr } from "@/components/PhoneQr";
import { Badge } from "@/components/ui";

type Tab = "today" | "plan" | "diary" | "docs";

const TAB_ICON: Record<Tab, string> = { today: "🏠", plan: "📅", diary: "📒", docs: "📄" };

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("today");
  const [msg, setMsg] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [engine, setEngine] = useState<{ extraction: string; model?: string | null; vision?: string | null }>({ extraction: "…" });
  const { persona, today, notices, entries, notifications } = useStore();
  const setPersona = useStore((s) => s.setPersona);
  const reset = useStore((s) => s.reset);

  useEffect(() => {
    // Render only on the client: state lives in localStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    fetch("/api/status")
      .then((r) => r.json())
      .then((s) => setEngine(s))
      .catch(() => setEngine({ extraction: "rules" }));
  }, []);

  const toast = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  };

  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
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
  const engineLabel =
    engine.extraction === "open"
      ? `open-source · ${engine.model}${engine.vision && engine.vision !== engine.model ? ` + ${engine.vision}` : ""}`
      : engine.extraction === "claude"
        ? "Claude"
        : engine.extraction === "rules"
          ? "rule-based (no model configured)"
          : "…";

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="sticky top-0 z-10 border-b border-stone-800 bg-stone-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 font-black text-stone-950">S</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">SiteFlow</p>
              <p className="truncate text-xs leading-tight text-stone-400">{PROJECT.name}</p>
            </div>
          </div>
          <span className="rounded-md bg-stone-800 px-2 py-1 text-xs text-amber-300">📅 {dayLabel(today)}</span>
          <span className="hidden text-xs text-stone-400 lg:inline">AI: {engineLabel}</span>
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <button onClick={() => setShowQr(true)} className="rounded-lg px-2 py-1.5 text-xs text-stone-300 hover:bg-stone-800 hover:text-white">
              📱 Open on phone
            </button>
            <button
              onClick={() => {
                if (confirm("Reset the demo to its starting state?")) reset();
              }}
              className="rounded-lg px-2 py-1.5 text-xs text-stone-400 hover:bg-stone-800 hover:text-white"
            >
              Reset demo
            </button>
          </div>
          {/* Persona switch: full width on phones */}
          <label className="flex w-full items-center gap-2 sm:w-auto">
            <span className="text-xs text-stone-400">Acting as</span>
            <select
              value={persona}
              onChange={(e) => setPersona(e.target.value as PersonaId)}
              className="min-w-0 flex-1 rounded-lg border border-stone-700 bg-stone-800 px-2 py-2 text-base text-white sm:flex-none sm:py-1.5 sm:text-sm"
            >
              {PERSONAS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} – {p.role}
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* Top tabs on tablet/desktop */}
        <nav className="mx-auto hidden max-w-7xl gap-1 px-4 sm:flex">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => go(t.id)}
              className={`flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm font-medium ${tab === t.id ? "bg-stone-100 text-stone-900" : "text-stone-300 hover:text-white"}`}
            >
              {t.label}
              {t.count !== undefined && <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-stone-950">{t.count}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-3 pb-24 pt-3 sm:px-4 sm:pb-8 sm:pt-4">
        <p className="mb-3 text-sm text-stone-600">
          {me.name} · <span className="text-stone-500">{me.role}</span>{" "}
          {persona === "site-manager" ? <Badge tone="amber">approves</Badge> : <Badge tone="blue">updates own tasks</Badge>}
        </p>
        {tab === "today" && <Today goDocs={() => go("docs")} toast={toast} />}
        {tab === "plan" && <Plan />}
        {tab === "diary" && <Diary />}
        {tab === "docs" && <Documents toast={toast} />}
        <div className="mt-8 space-y-2 text-center text-xs text-stone-400">
          <p className="lg:hidden">AI: {engineLabel}</p>
          <p>
            Prototype · synthetic data · drafts are a drafting aid, not legal advice – the site manager reviews everything before sending. ·{" "}
            <a href="/platform.html" className="underline hover:text-stone-600">
              How the platform works
            </a>
          </p>
          <button
            onClick={() => {
              if (confirm("Reset the demo to its starting state?")) reset();
            }}
            className="underline sm:hidden"
          >
            Reset demo
          </button>
        </div>
      </main>

      {/* Bottom tab bar on phones (thumb-friendly) */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => go(t.id)} className={`relative flex flex-col items-center gap-0.5 py-2 text-xs ${tab === t.id ? "font-semibold text-amber-600" : "text-stone-500"}`}>
            <span className="text-lg leading-none">{TAB_ICON[t.id]}</span>
            {t.label}
            {t.count !== undefined && <span className="absolute right-[22%] top-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-stone-950">{t.count}</span>}
          </button>
        ))}
      </nav>

      {showQr && <PhoneQr onClose={() => setShowQr(false)} />}
      {msg && <div className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white shadow-lg sm:bottom-4">{msg}</div>}
    </div>
  );
}
