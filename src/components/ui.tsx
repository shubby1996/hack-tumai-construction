"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-[#e8e6e3] bg-white ${className}`}>
      {(title || right) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 pb-1 pt-4 sm:px-5">
          <h2 className="text-[15px] font-medium text-[#1e1f21]">{title}</h2>
          {right}
        </header>
      )}
      <div className="px-4 pb-4 pt-3 sm:px-5">{children}</div>
    </section>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-[#ef6b62] text-white hover:bg-[#e2564d] disabled:bg-[#f6b7b2]",
  secondary: "border border-[#cfcbcb] bg-white text-[#1e1f21] hover:bg-[#f5f4f3] disabled:text-stone-400",
  ghost: "text-[#6d6e6f] hover:bg-[#f5f4f3]",
  danger: "bg-red-600 text-white hover:bg-red-500",
  success: "bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-emerald-200",
};

export function Button({ variant = "secondary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed sm:min-h-0 sm:py-1.5 ${VARIANTS[variant]} ${className}`}
    />
  );
}

const TONES = {
  stone: "bg-[#efedec] text-[#4b4c4e]",
  amber: "bg-[#fdecc8] text-[#8a5a00]",
  red: "bg-[#fde2e0] text-[#b42318]",
  green: "bg-[#d8f2e4] text-[#0f6b3e]",
  blue: "bg-[#dfe9fb] text-[#2d5bb8]",
  violet: "bg-[#ece4fb] text-[#6a3fc0]",
};

export function Badge({ tone = "stone", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-medium text-stone-500">
      {label}
      <div className="mt-1 text-sm text-stone-900">{children}</div>
    </label>
  );
}

export const inputCls = "w-full rounded-md border border-[#cfcbcb] bg-white px-2.5 py-2 text-base sm:py-1.5 sm:text-sm focus:border-[#4573d2] focus:outline-none focus:ring-2 focus:ring-[#4573d2]/20";

// ---------------------------------------------------------------- avatars

const AVATAR_COLORS: Record<string, string> = {
  "site-manager": "#ef6b62",
  earthworks: "#d9a144",
  formwork: "#4573d2",
  rebar: "#9b6bd6",
  concrete: "#2f9e8f",
};

export function Avatar({ id, name, size = 24 }: { id: string; name: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: AVATAR_COLORS[id] ?? "#8f8f8f" }}
    >
      {initials}
    </span>
  );
}

/** Asana-style round completion checkbox. */
export function CheckCircle({ done, onClick, disabled }: { done: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      disabled={disabled}
      title={done ? "Mark incomplete" : "Mark complete"}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition ${done ? "border-[#58a182] bg-[#58a182] text-white" : "border-[#9ca0a5] text-transparent hover:border-[#58a182] hover:text-[#58a182]"} disabled:cursor-default disabled:opacity-60`}
    >
      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M3 8.5l3 3 7-7" />
      </svg>
    </button>
  );
}
