import { DAY_MS, type Day, ymdOfDay } from "../core/date";

/** Locale-aware labels. Formatting happens on UTC dates built from civil days, so zones never shift them. */
export class Formatter {
	private readonly cache = new Map<string, Intl.DateTimeFormat>();
	readonly locale: string | undefined;
	readonly hour12: boolean;

	constructor(locale: string | undefined, hour12: boolean | undefined) {
		this.locale = locale;
		const probe = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions();
		this.hour12 = hour12 ?? (probe.hour12 === true || probe.hourCycle === "h12" || probe.hourCycle === "h11");
	}

	private fmt(key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
		let f = this.cache.get(key);
		if (!f) {
			f = new Intl.DateTimeFormat(this.locale, { timeZone: "UTC", ...opts });
			this.cache.set(key, f);
		}
		return f;
	}

	private d(day: Day): Date {
		return new Date(day * DAY_MS);
	}

	weekdayShort(day: Day): string {
		return this.fmt("wds", { weekday: "short" }).format(this.d(day));
	}
	weekdayLong(day: Day): string {
		return this.fmt("wdl", { weekday: "long" }).format(this.d(day));
	}
	weekdayNarrow(day: Day): string {
		return this.fmt("wdn", { weekday: "narrow" }).format(this.d(day));
	}
	dayNumber(day: Day): string {
		return this.fmt("dn", { day: "numeric" }).format(this.d(day));
	}
	monthShort(day: Day): string {
		return this.fmt("ms", { month: "short" }).format(this.d(day));
	}
	monthLong(day: Day): string {
		return this.fmt("ml", { month: "long" }).format(this.d(day));
	}
	monthYear(day: Day): string {
		return this.fmt("my", { month: "long", year: "numeric" }).format(this.d(day));
	}
	year(day: Day): string {
		return this.fmt("y", { year: "numeric" }).format(this.d(day));
	}
	fullDate(day: Day): string {
		return this.fmt("fd", { year: "numeric", month: "long", day: "numeric" }).format(this.d(day));
	}
	longDate(day: Day): string {
		return this.fmt("ld", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(this.d(day));
	}
	listDay(day: Day): string {
		return this.fmt("lst", { weekday: "short", month: "short", day: "numeric" }).format(this.d(day));
	}

	/** "Oct 19 – 25, 2026" style. */
	range(startDay: Day, lastDay: Day): string {
		if (startDay === lastDay) return this.fullDate(startDay);
		const f = this.fmt("rng", { year: "numeric", month: "short", day: "numeric" });
		try {
			return f.formatRange(this.d(startDay), this.d(lastDay));
		} catch {
			return `${f.format(this.d(startDay))} – ${f.format(this.d(lastDay))}`;
		}
	}

	/** Wall-clock minutes to a label. `compact` drops ":00" in 12-hour formats ("9am"). */
	time(minute: number, compact = false): string {
		const m = ((Math.round(minute) % 1440) + 1440) % 1440;
		const date = new Date(Date.UTC(2000, 0, 1, Math.floor(m / 60), m % 60));
		if (this.hour12) {
			const parts = this.fmt("t12", { hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(date);
			const english = (this.fmt("t12", {}).resolvedOptions().locale ?? "en").startsWith("en");
			const out: string[] = [];
			parts.forEach((p, i) => {
				const prev = parts[i - 1];
				if (compact && p.type === "minute" && p.value === "00") {
					if (prev?.type === "literal") out.pop();
					return;
				}
				if (compact && english && p.type === "dayPeriod") {
					if (prev?.type === "literal" && /^\s+$/.test(prev.value)) out.pop();
					out.push(p.value.toLowerCase().replace(/\./g, ""));
					return;
				}
				out.push(p.value);
			});
			return out.join("").trim();
		}
		return this.fmt("t24", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
	}

	/** Hour labels for the gutter. */
	slotLabel(minute: number): string {
		return this.time(minute, true);
	}

	isoDate(day: Day): string {
		const { year, month, day: d } = ymdOfDay(day);
		return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
	}
}

/** First day of the week for a locale (0 = Sunday), from Intl.Locale weekInfo where supported. */
export function localeFirstDay(locale: string | undefined): number {
	try {
		const loc = new Intl.Locale(locale ?? new Intl.DateTimeFormat().resolvedOptions().locale) as Intl.Locale & {
			weekInfo?: { firstDay: number };
			getWeekInfo?: () => { firstDay: number };
		};
		const info = loc.getWeekInfo?.() ?? loc.weekInfo;
		if (info) return info.firstDay % 7;
	} catch {
		// Fall through.
	}
	return 0;
}
