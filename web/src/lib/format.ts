import clsx, { type ClassValue } from "clsx";

export const cn = (...inputs: ClassValue[]) => clsx(inputs);

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatDate(value: string | null | undefined) {
  return value ? dateFmt.format(new Date(value)) : "—";
}

export function formatDateTime(value: string | null | undefined) {
  return value ? dateTimeFmt.format(new Date(value)) : "—";
}

export function timeAgo(value: string | null | undefined) {
  if (!value) return "—";
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return relFmt.format(Math.round(seconds / size), unit);
  return "just now";
}

/** "WAREHOUSE_RECEIVED" → "Warehouse received" */
export function humanize(value: string | null | undefined) {
  if (!value) return "—";
  const s = value.replace(/^ORG_/, "").replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function shortHash(hash: string | null | undefined, size = 6) {
  if (!hash) return "—";
  const clean = hash.startsWith("0x") ? hash : hash;
  return clean.length <= size * 2 + 3 ? clean : `${clean.slice(0, size + (clean.startsWith("0x") ? 2 : 0))}…${clean.slice(-size)}`;
}

export const number = (n: number | null | undefined) => (n ?? 0).toLocaleString();
