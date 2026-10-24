import { DAY_MS, type Day, dayFromYMD } from "./date";

/**
 * Converts between instants (epoch ms) and wall-clock time in one zone.
 * "local" uses the runtime's zone; any IANA name uses Intl.
 */
export interface TimeZone {
	readonly id: string;
	/** UTC offset in minutes (east positive) at an instant. */
	offsetAt(ms: number): number;
}

export interface WallTime {
	day: Day;
	/** Minutes since local midnight, 0..1439. */
	minute: number;
}

class LocalZone implements TimeZone {
	readonly id = "local";
	offsetAt(ms: number): number {
		return -new Date(ms).getTimezoneOffset();
	}
}

class IanaZone implements TimeZone {
	private readonly fmt: Intl.DateTimeFormat;
	private readonly cache = new Map<number, number>();

	constructor(readonly id: string) {
		this.fmt = new Intl.DateTimeFormat("en-US", {
			timeZone: id,
			hourCycle: "h23",
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
		});
	}

	offsetAt(ms: number): number {
		// Offsets only change on transitions, which fall on quarter hours.
		const bucket = Math.floor(ms / 900_000);
		const hit = this.cache.get(bucket);
		if (hit !== undefined) return hit;
		const at = bucket * 900_000;
		const p: Record<string, number> = {};
		for (const part of this.fmt.formatToParts(new Date(at))) {
			if (part.type !== "literal") p[part.type] = Number(part.value);
		}
		const wall = dayFromYMD(p.year!, p.month!, p.day!) * DAY_MS + ((p.hour! * 60 + p.minute!) * 60 + p.second!) * 1000;
		const offset = Math.round((wall - at) / 60_000);
		if (this.cache.size > 5000) this.cache.clear();
		this.cache.set(bucket, offset);
		return offset;
	}
}

const zones = new Map<string, TimeZone>();

export function getTimeZone(id: string | undefined | null): TimeZone {
	const key = !id || id === "local" ? "local" : id;
	let z = zones.get(key);
	if (!z) {
		z = key === "local" ? new LocalZone() : new IanaZone(key);
		zones.set(key, z);
	}
	return z;
}

export function isValidTimeZone(id: string): boolean {
	if (id === "local") return true;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: id });
		return true;
	} catch {
		return false;
	}
}

export function wallTime(ms: number, zone: TimeZone): WallTime {
	const local = ms + zone.offsetAt(ms) * 60_000;
	const day = Math.floor(local / DAY_MS);
	return { day, minute: Math.floor((local - day * DAY_MS) / 60_000) };
}

export function dayOf(ms: number, zone: TimeZone): Day {
	return wallTime(ms, zone).day;
}

/**
 * Wall-clock time to instant. Times inside a DST gap move forward by the gap
 * (02:30 on a spring-forward day becomes 03:30); ambiguous times resolve to the
 * earlier instant. This matches how Date resolves local times.
 */
export function toInstant(day: Day, minute: number, zone: TimeZone): number {
	const localTs = day * DAY_MS + minute * 60_000;
	const o = zone.offsetAt(localTs);
	let utc = localTs - o * 60_000;
	const o2 = zone.offsetAt(utc);
	if (o === o2) return utc;
	utc -= (o2 - o) * 60_000;
	const o3 = zone.offsetAt(utc);
	if (o2 === o3) return utc;
	return localTs - Math.min(o2, o3) * 60_000;
}

export function startOfDayInstant(day: Day, zone: TimeZone): number {
	return toInstant(day, 0, zone);
}

/** Length of a civil day in minutes (1380 or 1500 on DST change days). */
export function dayLengthMinutes(day: Day, zone: TimeZone): number {
	return Math.round((startOfDayInstant(day + 1, zone) - startOfDayInstant(day, zone)) / 60_000);
}

const FLOATING_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ParsedDate = { kind: "day"; day: Day } | { kind: "instant"; ms: number };

/**
 * Parses calendar input. Date-only strings are civil days; date-times without
 * an offset are wall-clock times in `zone`; anything with Z or an offset is an
 * absolute instant.
 */
export function parseDateInput(value: Date | string | number, zone: TimeZone): ParsedDate | null {
	if (value instanceof Date) {
		const t = value.getTime();
		return Number.isNaN(t) ? null : { kind: "instant", ms: t };
	}
	if (typeof value === "number") return Number.isFinite(value) ? { kind: "instant", ms: value } : null;
	const s = value.trim();
	let m = DATE_ONLY_RE.exec(s);
	if (m) return { kind: "day", day: dayFromYMD(Number(m[1]), Number(m[2]), Number(m[3])) };
	m = FLOATING_RE.exec(s);
	if (m) {
		const day = dayFromYMD(Number(m[1]), Number(m[2]), Number(m[3]));
		const minute = Number(m[4]) * 60 + Number(m[5]);
		const extraMs = Number(m[6] ?? 0) * 1000 + Number((m[7] ?? "0").padEnd(3, "0"));
		return { kind: "instant", ms: toInstant(day, minute, zone) + extraMs };
	}
	const t = Date.parse(s);
	return Number.isNaN(t) ? null : { kind: "instant", ms: t };
}

/** Formats an instant as a floating local date-time ("YYYY-MM-DDTHH:mm") in `zone`. */
export function formatFloating(ms: number, zone: TimeZone): string {
	const { day, minute } = wallTime(ms, zone);
	const d = new Date(day * DAY_MS);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}
