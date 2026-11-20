import { PROJECT } from "./seed";

/** Working-day index (Mon–Fri) → Date, counted from PROJECT.planStart. */
export function dayToDate(day: number): Date {
  const d = new Date(`${PROJECT.planStart}T12:00:00Z`);
  let added = 0;
  const step = day >= 0 ? 1 : -1;
  while (added !== day) {
    d.setUTCDate(d.getUTCDate() + step);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) added += step;
  }
  return d;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const dayLabel = (day: number) => {
  const d = dayToDate(day);
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`;
};

export const dayShort = (day: number) => {
  const d = dayToDate(day);
  return { wd: WD[d.getUTCDay()], date: `${d.getUTCDate()}.${d.getUTCMonth() + 1}.` };
};

/** German date for letters, e.g. 24.11.2026 */
export const dayDE = (day: number) => {
  const d = dayToDate(day);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
};

export const clock = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
