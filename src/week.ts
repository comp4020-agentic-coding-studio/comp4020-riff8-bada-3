// Week arithmetic for the archive's weekly roots. A week starts at 00:00
// Monday in Sydney, whose UTC offset is +10 or +11 depending on daylight
// saving --- so the offset is always asked of Intl for the instant in
// question, never hard-coded. Pure: everything takes the Date it reasons about.

export const TIME_ZONE = "Australia/Sydney";

const partsFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(at: Date): LocalParts {
  const out: Record<string, number> = {};
  for (const p of partsFormat.formatToParts(at)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as unknown as LocalParts;
}

// Sydney's offset from UTC at an instant, in milliseconds (+10h or +11h).
function offsetAt(at: Date): number {
  const p = localParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// The instant at which Sydney's wall clock reads 00:00 on the given date.
// Sydney's DST transitions happen at 02:00/03:00, so midnight always exists
// exactly once; two passes settle the offset either side of a transition.
function sydneyMidnight(year: number, month: number, day: number): Date {
  const wall = Date.UTC(year, month - 1, day);
  let guess = wall - offsetAt(new Date(wall));
  guess = wall - offsetAt(new Date(guess));
  return new Date(guess);
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface Week {
  // the Monday's date in Sydney, e.g. "2026-10-05": the week's stable key
  start: string;
  // the instant the week begins (00:00 Monday Sydney)
  startsAt: Date;
}

export function weekOf(at: Date): Week {
  const p = localParts(at);
  // Day arithmetic on the wall-clock date, done in UTC so no offset intrudes.
  const local = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - sinceMonday);
  const [y, m, d] = [local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()];
  return { start: isoDate(y, m, d), startsAt: sydneyMidnight(y, m, d) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Week of 5 Oct 2026" for a week start like "2026-10-05". Spelled out by hand:
// Intl's en-AU short month for September is "Sept".
export function weekLabel(start: string): string {
  const [y, m, d] = start.split("-").map(Number);
  return `Week of ${d} ${MONTHS[m - 1]} ${y}`;
}
