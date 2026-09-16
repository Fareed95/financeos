import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function newId(): string {
  return crypto.randomUUID();
}

export function todayISO(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfMonthISO(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function endOfMonthISO(date = new Date()): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  if (!y || !m) return isoDate;
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

export function formatLongDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00`);
  const b = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, (d ?? 1) + days);
  return todayISO(dt);
}

export function eachDayISO(from: string, to: string, cap = 62): string[] {
  const out: string[] = [];
  let cursor = from;
  let n = 0;
  while (cursor <= to && n < cap) {
    out.push(cursor);
    cursor = addDaysISO(cursor, 1);
    n += 1;
  }
  return out;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function publicError(err: unknown, fallback: string): never {
  if (err instanceof Error && err.message === "Unauthorized") throw err;
  if (err instanceof Error && err.message && !/sql|postgres|relation|column/i.test(err.message)) {
    throw err;
  }
  console.error(err);
  throw new Error(fallback);
}

export function isUnauthorized(err: unknown): boolean {
  return (
    (err instanceof Error && (err.message === "Unauthorized" || err.message.includes("Unauthorized"))) ||
    (typeof err === "object" && err !== null && "status" in err && (err as { status: number }).status === 401)
  );
}
