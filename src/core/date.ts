/**
 * Civil (calendar) days are integers: days since 1970-01-01. They carry no time
 * zone. Instants are epoch milliseconds. A {@link TimeZone} converts between the
 * two, so all day arithmetic stays exact across DST changes.
 */
export type Day = number;

export const DAY_MS = 86_400_000;
export const MINUTES_PER_DAY = 1440;

export interface YMD {
	year: number;
	month: number; // 1-12
	day: number; // 1-31
}

export function dayFromYMD(year: number, month: number, day: number): Day {
	const d = new Date(0);
	d.setUTCFullYear(year, month - 1, day);
	d.setUTCHours(0, 0, 0, 0);
	return Math.floor(d.getTime() / DAY_MS);
}

export function ymdOfDay(day: Day): YMD {
	const d = new Date(day * DAY_MS);
	return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekdayOf(day: Day): number {
	return (((day + 4) % 7) + 7) % 7;
}

export function startOfWeek(day: Day, firstDay: number): Day {
	return day - ((weekdayOf(day) - firstDay + 7) % 7);
}

export function startOfMonth(day: Day): Day {
	const { year, month } = ymdOfDay(day);
	return dayFromYMD(year, month, 1);
}

export function daysInMonth(year: number, month: number): number {
	return dayFromYMD(year, month + 1, 1) - dayFromYMD(year, month, 1);
}

/** Adds calendar months, clamping the day of month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(day: Day, months: number): Day {
	const { year, month, day: dom } = ymdOfDay(day);
	const total = year * 12 + (month - 1) + months;
	const y = Math.floor(total / 12);
	const m = (total % 12) + 1;
	return dayFromYMD(y, m, Math.min(dom, daysInMonth(y, m)));
}

export function startOfYear(day: Day): Day {
	return dayFromYMD(ymdOfDay(day).year, 1, 1);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatDay(day: Day): string {
	const { year, month, day: d } = ymdOfDay(day);
	const y = year < 0 ? "-" + String(-year).padStart(6, "0") : String(year).padStart(4, "0");
	return `${y}-${pad2(month)}-${pad2(d)}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDay(value: string): Day | null {
	const m = DATE_RE.exec(value.trim());
	if (!m) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const d = Number(m[3]);
	if (month < 1 || month > 12 || d < 1 || d > daysInMonth(year, month)) return null;
	return dayFromYMD(year, month, d);
}

/** ISO 8601 week number (weeks start Monday; week 1 contains Jan 4). */
export function isoWeekNumber(day: Day): number {
	const thursday = day - ((weekdayOf(day) + 6) % 7) + 3;
	const jan1 = dayFromYMD(ymdOfDay(thursday).year, 1, 1);
	return Math.floor((thursday - jan1) / 7) + 1;
}

/** Parses "HH:mm" or "HH:mm:ss" durations (FullCalendar-style, may exceed 24h). */
export function parseDurationMinutes(value: string | number | null | undefined, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return fallback;
	const m = /^(-?\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
	if (!m) return fallback;
	const sign = m[1]!.startsWith("-") ? -1 : 1;
	return sign * (Math.abs(Number(m[1])) * 60 + Number(m[2]) + Number(m[3] ?? 0) / 60);
}

export function formatMinutes(minutes: number): string {
	const m = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
	return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
