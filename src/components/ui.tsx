"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-amber-500 text-stone-950 hover:bg-amber-400 disabled:bg-amber-200",
  secondary: "bg-stone-100 text-stone-800 hover:bg-stone-200 disabled:text-stone-400",
  ghost: "text-stone-600 hover:bg-stone-100",
  danger: "bg-red-600 text-white hover:bg-red-500",
  success: "bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-emerald-200",
};

export function Button({ variant = "secondary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

const TONES = {
  stone: "bg-stone-100 text-stone-700",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  green: "bg-emerald-100 text-emerald-700",
  blue: "bg-blue-100 text-blue-700",
  violet: "bg-violet-100 text-violet-700",
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

export const inputCls = "w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200";
