import type { BlackoutWindow } from "./settings";
import type { WeeklyHours } from "./db/schema";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

/** Wall-clock parts of `date` in `tz`. weekday: 1=Mon … 7=Sun. */
export function zonedParts(date: Date, tz: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: wd,
  };
}

/** Converts a wall-clock time in `tz` to the UTC instant. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const target = Date.UTC(year, month - 1, day, hour, minute);
    const diff = target - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

export function isInBlackout(date: Date, blackouts: BlackoutWindow[], tz: string): BlackoutWindow | null {
  const p = zonedParts(date, tz);
  const mins = p.hour * 60 + p.minute;
  for (const b of blackouts) {
    if (b.days.includes(p.weekday) && mins >= toMin(b.start) && mins < toMin(b.end)) return b;
  }
  return null;
}

/**
 * True when [start, end) intersects any blackout window. Computed exactly per
 * local day (sampling could step over a window edge, e.g. 14:58–15:02).
 */
export function overlapsBlackout(start: Date, end: Date, blackouts: BlackoutWindow[], tz: string): boolean {
  const s = start.getTime();
  const e = end.getTime();
  if (e <= s || !blackouts.length) return false;
  const first = zonedParts(start, tz);
  // Start one local day early so a window that began the previous day is covered.
  for (let d = -1; ; d++) {
    const dayUtc = new Date(Date.UTC(first.year, first.month - 1, first.day + d, 12));
    const y = dayUtc.getUTCFullYear();
    const m = dayUtc.getUTCMonth() + 1;
    const day = dayUtc.getUTCDate();
    if (zonedToUtc(y, m, day, 0, 0, tz).getTime() >= e) break;
    const weekday = zonedParts(zonedToUtc(y, m, day, 12, 0, tz), tz).weekday;
    for (const b of blackouts) {
      if (!b.days.includes(weekday)) continue;
      const bs = toMin(b.start);
      const be = toMin(b.end);
      if (be <= bs) continue;
      const ws = zonedToUtc(y, m, day, Math.floor(bs / 60), bs % 60, tz).getTime();
      const we = zonedToUtc(y, m, day, Math.floor(be / 60), be % 60, tz).getTime();
      if (s < we && ws < e) return true;
    }
  }
  return false;
}

export type Busy = { startsAt: Date; endsAt: Date };

export function availableSlots(opts: {
  hours: WeeklyHours;
  durationMin: number;
  bufferMin: number;
  from: Date;
  days: number;
  busy: Busy[];
  blackouts: BlackoutWindow[];
  tz: string;
  stepMin?: number;
  minLeadMin?: number;
}): Date[] {
  const { hours, durationMin, bufferMin, from, days, busy, blackouts, tz } = opts;
  const step = opts.stepMin ?? 30;
  const earliest = from.getTime() + (opts.minLeadMin ?? 120) * 60_000;
  const out: Date[] = [];
  const start = zonedParts(from, tz);
  for (let d = 0; d < days; d++) {
    const dayUtc = new Date(Date.UTC(start.year, start.month - 1, start.day + d, 12));
    const y = dayUtc.getUTCFullYear();
    const m = dayUtc.getUTCMonth() + 1;
    const day = dayUtc.getUTCDate();
    const weekday = zonedParts(zonedToUtc(y, m, day, 12, 0, tz), tz).weekday;
    const ranges = hours[WEEKDAYS[weekday - 1]] ?? [];
    for (const r of ranges) {
      for (let mins = toMin(r.start); mins + durationMin <= toMin(r.end); mins += step) {
        const s = zonedToUtc(y, m, day, Math.floor(mins / 60), mins % 60, tz);
        const e = new Date(s.getTime() + durationMin * 60_000);
        if (s.getTime() < earliest) continue;
        if (overlapsBlackout(s, e, blackouts, tz)) continue;
        const clash = busy.some(
          (b) => s.getTime() < b.endsAt.getTime() + bufferMin * 60_000 && e.getTime() + bufferMin * 60_000 > b.startsAt.getTime(),
        );
        if (!clash) out.push(s);
      }
    }
  }
  return out;
}

export function formatInTz(date: Date, tz: string, opts: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(date);
}

/** Spoken/printed zone name, e.g. "Pacific Time". The zone is a setting, so never hard-code it. */
export function tzLabel(tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? tz;
}

export function formatSlot(date: Date, tz: string) {
  return formatInTz(date, tz, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const DEFAULT_HOURS: WeeklyHours = {
  mon: [{ start: "09:00", end: "18:00" }],
  tue: [{ start: "09:00", end: "18:00" }],
  wed: [{ start: "09:00", end: "18:00" }],
  thu: [{ start: "09:00", end: "18:00" }],
  fri: [{ start: "09:00", end: "16:00" }],
};

/** Start (inclusive) and end (exclusive) of the current local week, Monday-based. */
export function weekBounds(now: Date, tz: string) {
  const p = zonedParts(now, tz);
  const start = zonedToUtc(p.year, p.month, p.day - (p.weekday - 1), 0, 0, tz);
  // Local midnight, not +168h: DST weeks are 167 or 169 hours long.
  const end = zonedToUtc(p.year, p.month, p.day - (p.weekday - 1) + 7, 0, 0, tz);
  return { start, end };
}

export function dayBounds(now: Date, tz: string) {
  const p = zonedParts(now, tz);
  const start = zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
  // Local midnight, not +24h: DST days are 23 or 25 hours long.
  return { start, end: zonedToUtc(p.year, p.month, p.day + 1, 0, 0, tz) };
}

export function localDateKey(now: Date, tz: string) {
  const p = zonedParts(now, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
