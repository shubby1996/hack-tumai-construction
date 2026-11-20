"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { PERSONAS, PROJECT } from "@/lib/seed";
import type { PersonaId } from "@/lib/types";
import { Today } from "@/components/Today";
import { Timeline } from "@/components/Plan";
import { TaskList } from "@/components/TaskList";
import { Board } from "@/components/Board";
import { TaskDrawer } from "@/components/TaskDrawer";
import { Inbox } from "@/components/Inbox";
import { Diary } from "@/components/Diary";
import { Documents } from "@/components/Documents";
import { PhoneQr } from "@/components/PhoneQr";
import { Avatar } from "@/components/ui";

type View = "home" | "mytasks" | "inbox" | "project";
type ProjTab = "list" | "board" | "timeline" | "diary" | "docs";

const PROJ_TABS: { id: ProjTab; label: string }[] = [
  { id: "list", label: "List" },
  { id: "board", label: "Board" },
  { id: "timeline", label: "Timeline" },
  { id: "diary", label: "Diary" },
  { id: "docs", label: "Documents" },
];

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<View>("home");
  const [projTab, setProjTab] = useState<ProjTab>("list");
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false); // phones
  const [msg, setMsg] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [engine, setEngine] = useState<{ extraction: string; model?: string | null; vision?: string | null }>({ extraction: "…" });
  const { persona, notices, notifications } = useStore();
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
  const go = (v: View, tab?: ProjTab) => {
    setView(v);
    if (tab) setProjTab(tab);
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  };

  if (!mounted) return <div className="p-8 text-[#6d6e6f]">Loading…</div>;

  const me = PERSONAS.find((p) => p.id === persona)!;
  const unread = notifications.filter((n) => n.to.includes(persona) && !n.readBy.includes(persona)).length;
  const drafts = notices.filter((n) => n.status === "draft").length;
  const isSM = persona === "site-manager";
  const engineLabel =
    engine.extraction === "open"
      ? `open-source · ${engine.model}${engine.vision && engine.vision !== engine.model ? ` + ${engine.vision}` : ""}`
      : engine.extraction === "claude"
        ? "Claude"
        : engine.extraction === "rules"
          ? "rule-based (no model configured)"
          : "…";

  const title = view === "home" ? "Home" : view === "mytasks" ? "My tasks" : view === "inbox" ? "Inbox" : PROJECT.name;

  const sidebar = (
    <nav className="flex h-full flex-col bg-[#1e1f21] text-[#f5f4f3]">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#ef6b62] text-sm font-black text-white">S</span>
        <span className="text-base font-semibold">SiteFlow</span>
        <button className="ml-auto rounded p-1 text-[#a2a0a2] hover:bg-white/10 lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
          ✕
        </button>
      </div>
      <div className="px-3">
        <button onClick={() => go("home")} className="mb-3 flex w-full items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#ef6b62] text-xs text-white">+</span> Create note
        </button>
        <SideItem icon="🏠" label="Home" active={view === "home"} onClick={() => go("home")} />
        <SideItem icon="✔︎" label={isSM ? "All open tasks" : "My tasks"} active={view === "mytasks"} onClick={() => go("mytasks")} />
        <SideItem icon="🔔" label="Inbox" count={unread} active={view === "inbox"} onClick={() => go("inbox")} />
      </div>
      <div className="mt-5 px-3">
        <p className="px-2 pb-1 text-xs font-medium text-[#a2a0a2]">Projects</p>
        <button onClick={() => go("project", "list")} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${view === "project" ? "bg-white/15" : "hover:bg-white/10"}`}>
          <span className="h-3 w-3 rounded-[4px] bg-[#4573d2]" />
          <span className="truncate">{PROJECT.name}</span>
        </button>
        <div className="ml-5 mt-0.5 space-y-0.5">
          {PROJ_TABS.map((t) => (
            <button key={t.id} onClick={() => go("project", t.id)} className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs ${view === "project" && projTab === t.id ? "text-white" : "text-[#a2a0a2] hover:text-white"}`}>
              {t.label}
              {t.id === "docs" && drafts > 0 && <span className="rounded-full bg-[#ef6b62] px-1.5 text-[10px] text-white">{drafts}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-auto space-y-2 border-t border-white/10 p-3">
        <label className="block text-xs text-[#a2a0a2]">
          Acting as
          <span className="mt-1 flex items-center gap-2 rounded-md bg-white/10 px-2 py-1.5">
            <Avatar id={me.id} name={me.name} size={22} />
            <select value={persona} onChange={(e) => setPersona(e.target.value as PersonaId)} className="min-w-0 flex-1 bg-transparent text-base text-white outline-none sm:text-sm">
              {PERSONAS.map((p) => (
                <option key={p.id} value={p.id} className="text-black">
                  {p.name} – {p.role}
                </option>
              ))}
            </select>
          </span>
        </label>
        <p className="text-[11px] leading-snug text-[#a2a0a2]">AI: {engineLabel}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#a2a0a2]">
          <button onClick={() => setShowQr(true)} className="hidden hover:text-white sm:inline">
            📱 Open on phone
          </button>
          <a href="/platform.html" className="hover:text-white">
            How it works
          </a>
          <button
            onClick={() => {
              if (confirm("Reset the demo to its starting state?")) reset();
            }}
            className="hover:text-white"
          >
            Reset demo
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#f9f8f8] lg:pl-60">
      {/* Sidebar: fixed on desktop, slide-in on phones */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">{sidebar}</aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%]">{sidebar}</aside>
        </div>
      )}

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-[#e8e6e3] bg-white">
        <div className="flex items-center gap-3 px-3 pt-3 sm:px-6">
          <button className="rounded-md p-1.5 text-[#6d6e6f] hover:bg-[#f5f4f3] lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            ☰
          </button>
          {view === "project" && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#4573d2] text-sm text-white">🏗</span>}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-medium text-[#1e1f21] sm:text-xl">{title}</h1>
            {view === "project" && <p className="truncate text-xs text-[#6d6e6f]">{PROJECT.address} · {PROJECT.contractor} · two-week lookahead</p>}
          </div>
          <span className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-[#6d6e6f] md:inline">{me.role}</span>
            <Avatar id={me.id} name={me.name} size={30} />
          </span>
        </div>
        {view === "project" ? (
          <div className="mt-2 flex gap-4 overflow-x-auto px-3 sm:px-6">
            {PROJ_TABS.map((t) => (
              <button key={t.id} onClick={() => setProjTab(t.id)} className={`shrink-0 border-b-2 pb-2 text-sm ${projTab === t.id ? "border-[#1e1f21] font-medium text-[#1e1f21]" : "border-transparent text-[#6d6e6f] hover:text-[#1e1f21]"}`}>
                {t.label}
                {t.id === "docs" && drafts > 0 && <span className="ml-1 rounded-full bg-[#ef6b62] px-1.5 text-[10px] text-white">{drafts}</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="h-3" />
        )}
      </header>

      <main className="mx-auto max-w-6xl px-3 pb-24 pt-5 sm:px-6 lg:pb-10">
        {view === "home" && <Today goDocs={() => go("project", "docs")} toast={toast} onOpen={setOpenTask} />}
        {view === "mytasks" && <TaskList onOpen={setOpenTask} only={isSM ? undefined : persona} />}
        {view === "inbox" && <Inbox />}
        {view === "project" && projTab === "list" && <TaskList onOpen={setOpenTask} />}
        {view === "project" && projTab === "board" && <Board onOpen={setOpenTask} />}
        {view === "project" && projTab === "timeline" && <Timeline onOpen={setOpenTask} />}
        {view === "project" && projTab === "diary" && <Diary />}
        {view === "project" && projTab === "docs" && <Documents toast={toast} />}
        <p className="mt-10 text-center text-xs text-[#9ca0a5]">Prototype · synthetic data · drafts are a drafting aid, not legal advice – the site manager reviews everything before sending.</p>
      </main>

      {/* Bottom tab bar on phones */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-[#e8e6e3] bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        <BottomTab icon="🏠" label="Home" active={view === "home"} onClick={() => go("home")} />
        <BottomTab icon="✔︎" label="My tasks" active={view === "mytasks"} onClick={() => go("mytasks")} />
        <BottomTab icon="🔔" label="Inbox" count={unread} active={view === "inbox"} onClick={() => go("inbox")} />
        <BottomTab icon="🏗" label="Project" count={drafts || undefined} active={view === "project"} onClick={() => go("project", projTab)} />
      </nav>

      {openTask && <TaskDrawer taskId={openTask} onClose={() => setOpenTask(null)} />}
      {showQr && <PhoneQr onClose={() => setShowQr(false)} />}
      {msg && <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-[#1e1f21] px-4 py-2 text-sm text-white shadow-lg lg:bottom-6">{msg}</div>}
    </div>
  );
}

function SideItem({ icon, label, active, onClick, count }: { icon: string; label: string; active?: boolean; onClick: () => void; count?: number }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm ${active ? "bg-white/15 text-white" : "text-[#e6e4e2] hover:bg-white/10"}`}>
      <span className="w-4 text-center text-xs">{icon}</span>
      <span className="flex-1">{label}</span>
      {count ? <span className="rounded-full bg-[#ef6b62] px-1.5 text-[11px] text-white">{count}</span> : null}
    </button>
  );
}

function BottomTab({ icon, label, active, onClick, count }: { icon: ReactNode; label: string; active?: boolean; onClick: () => void; count?: number }) {
  return (
    <button onClick={onClick} className={`relative flex flex-col items-center gap-0.5 py-2 text-xs ${active ? "font-semibold text-[#ef6b62]" : "text-[#6d6e6f]"}`}>
      <span className="text-lg leading-none">{icon}</span>
      {label}
      {count ? <span className="absolute right-[22%] top-1 rounded-full bg-[#ef6b62] px-1.5 text-[10px] font-semibold text-white">{count}</span> : null}
    </button>
  );
}
