import { type Day, DAY_MS } from "./date";
import type { CalendarItem, NormalizedItem } from "./types";
import { dayOf, parseDateInput, startOfDayInstant, type TimeZone } from "./zone";

export interface StoreOptions {
	/** Length of timed items without an end, in minutes. */
	defaultTimedMinutes: number;
	/** Length of all-day items without an end, in days. */
	defaultAllDayDays: number;
}

export interface StoreChange {
	added: string[];
	updated: string[];
	removed: string[];
	/** Days whose timed content changed. */
	days: Set<Day>;
	/** True when any all-day (or multi-day) placement changed. */
	spans: boolean;
}

const DEFAULTS: StoreOptions = { defaultTimedMinutes: 60, defaultAllDayDays: 1 };

function signature(item: CalendarItem): string {
	if (item.rev !== undefined) return `${item.id}#${String(item.rev)}`;
	try {
		return JSON.stringify(item, (_k, v: unknown) => (v instanceof Date ? v.getTime() : v));
	} catch {
		// Cyclic data: fall back to a fresh token so the item always re-renders.
		return `${item.id}#${Math.random()}`;
	}
}

/**
 * Items indexed by the civil days they touch. Every mutation records which days
 * changed so layouts and DOM columns for untouched days can be reused.
 */
export class ItemStore<D = unknown> {
	private zone: TimeZone;
	private opts: StoreOptions;
	private readonly items = new Map<string, NormalizedItem<D>>();
	private readonly timedByDay = new Map<Day, Set<string>>();
	private readonly spanning = new Set<string>();
	private pending: StoreChange = ItemStore.emptyChange();
	/** Bumped on every change; cheap staleness check for caches. */
	version = 0;

	constructor(zone: TimeZone, opts: Partial<StoreOptions> = {}) {
		this.zone = zone;
		this.opts = { ...DEFAULTS, ...opts };
	}

	private static emptyChange(): StoreChange {
		return { added: [], updated: [], removed: [], days: new Set(), spans: false };
	}

	get size(): number {
		return this.items.size;
	}

	get timeZone(): TimeZone {
		return this.zone;
	}

	/** Re-resolves every item; used when the zone or defaults change. */
	reconfigure(zone: TimeZone, opts: Partial<StoreOptions> = {}): void {
		this.zone = zone;
		this.opts = { ...this.opts, ...opts };
		const all = [...this.items.values()].map((n) => n.item);
		this.items.clear();
		this.timedByDay.clear();
		this.spanning.clear();
		for (const it of all) this.insert(it, "added");
		this.pending.spans = true;
	}

	normalize(item: CalendarItem<D>): NormalizedItem<D> | null {
		const zone = this.zone;
		const s = parseDateInput(item.start, zone);
		if (!s) return null;
		const e = item.end != null && item.end !== "" ? parseDateInput(item.end, zone) : null;
		const allDay = item.allDay ?? s.kind === "day";
		const sig = signature(item);
		if (allDay) {
			const startDay = s.kind === "day" ? s.day : dayOf(s.ms, zone);
			let endDay = startDay + this.opts.defaultAllDayDays;
			if (e) {
				// An end that falls mid-day still covers that day.
				const ed = e.kind === "day" ? e.day : dayOf(e.ms - 1, zone) + 1;
				if (ed > startDay) endDay = ed;
			}
			return {
				id: item.id,
				item,
				allDay: true,
				startDay,
				endDay,
				startMs: startOfDayInstant(startDay, zone),
				endMs: startOfDayInstant(endDay, zone),
				sig,
			};
		}
		const startMs = s.kind === "instant" ? s.ms : startOfDayInstant(s.day, zone);
		let endMs = startMs + this.opts.defaultTimedMinutes * 60_000;
		if (e) {
			const em = e.kind === "instant" ? e.ms : startOfDayInstant(e.day, zone);
			if (em > startMs) endMs = em;
		}
		const startDay = dayOf(startMs, zone);
		const endDay = dayOf(endMs - 1, zone) + 1;
		return { id: item.id, item, allDay: false, startMs, endMs, startDay, endDay, sig };
	}

	private insert(item: CalendarItem<D>, kind: "added" | "updated"): boolean {
		const n = this.normalize(item);
		if (!n) return false;
		this.items.set(n.id, n);
		this.index(n);
		this.pending[kind].push(n.id);
		return true;
	}

	private index(n: NormalizedItem<D>): void {
		if (n.item.display === "none") return;
		if (n.allDay) {
			this.spanning.add(n.id);
			this.pending.spans = true;
			return;
		}
		if (n.endDay - n.startDay > 1) {
			this.spanning.add(n.id);
			this.pending.spans = true;
		}
		for (let d = n.startDay; d < n.endDay; d++) {
			let set = this.timedByDay.get(d);
			if (!set) this.timedByDay.set(d, (set = new Set()));
			set.add(n.id);
			this.pending.days.add(d);
		}
		// Day-grid views show timed items as single-day entries too.
		this.pending.spans = true;
	}

	private unindex(n: NormalizedItem<D>): void {
		if (this.spanning.delete(n.id)) this.pending.spans = true;
		if (!n.allDay) {
			for (let d = n.startDay; d < n.endDay; d++) {
				this.timedByDay.get(d)?.delete(n.id);
				this.pending.days.add(d);
			}
			this.pending.spans = true;
		}
	}

	/** Replaces the whole item set, touching only items whose signature changed. */
	setAll(items: Iterable<CalendarItem<D>>): StoreChange {
		const seen = new Set<string>();
		for (const item of items) {
			if (seen.has(item.id)) continue;
			seen.add(item.id);
			this.upsertOne(item);
		}
		for (const [id, n] of this.items) {
			if (!seen.has(id)) {
				this.unindex(n);
				this.items.delete(id);
				this.pending.removed.push(id);
			}
		}
		return this.flush();
	}

	/** Upserts items without removing others. */
	upsert(items: Iterable<CalendarItem<D>>): StoreChange {
		for (const item of items) this.upsertOne(item);
		return this.flush();
	}

	remove(ids: Iterable<string>): StoreChange {
		for (const id of ids) {
			const n = this.items.get(id);
			if (!n) continue;
			this.unindex(n);
			this.items.delete(id);
			this.pending.removed.push(id);
		}
		return this.flush();
	}

	private upsertOne(item: CalendarItem<D>): void {
		const prev = this.items.get(item.id);
		if (prev) {
			if (prev.sig === signature(item)) return;
			this.unindex(prev);
			this.items.delete(item.id);
			if (!this.insert(item, "updated")) this.pending.removed.push(item.id);
			return;
		}
		this.insert(item, "added");
	}

	private flush(): StoreChange {
		const out = this.pending;
		this.pending = ItemStore.emptyChange();
		if (out.added.length || out.updated.length || out.removed.length || out.spans || out.days.size) this.version++;
		return out;
	}

	get(id: string): NormalizedItem<D> | undefined {
		return this.items.get(id);
	}

	all(): IterableIterator<NormalizedItem<D>> {
		return this.items.values();
	}

	/** Timed items touching `day`. */
	timedOn(day: Day): NormalizedItem<D>[] {
		const set = this.timedByDay.get(day);
		if (!set) return [];
		const out: NormalizedItem<D>[] = [];
		for (const id of set) {
			const n = this.items.get(id);
			if (n) out.push(n);
		}
		return out;
	}

	/** All-day items (and, if asked, multi-day timed items) overlapping [startDay, endDay). */
	spanningIn(startDay: Day, endDay: Day, includeTimedMultiDay: boolean): NormalizedItem<D>[] {
		const out: NormalizedItem<D>[] = [];
		for (const id of this.spanning) {
			const n = this.items.get(id);
			if (!n || n.startDay >= endDay || n.endDay <= startDay) continue;
			if (!n.allDay && !includeTimedMultiDay) continue;
			out.push(n);
		}
		return out;
	}

	/** Every visible item overlapping [startDay, endDay). */
	inRange(startDay: Day, endDay: Day): NormalizedItem<D>[] {
		const seen = new Set<string>();
		const out: NormalizedItem<D>[] = [];
		for (const n of this.spanningIn(startDay, endDay, true)) {
			seen.add(n.id);
			out.push(n);
		}
		for (let d = startDay; d < endDay; d++) {
			for (const n of this.timedOn(d)) {
				if (seen.has(n.id)) continue;
				seen.add(n.id);
				out.push(n);
			}
		}
		return out;
	}
}

/** Days spanned by an instant range in a zone, end exclusive. */
export function daysOfRange(startMs: number, endMs: number, zone: TimeZone): [Day, Day] {
	return [dayOf(startMs, zone), dayOf(Math.max(startMs, endMs - 1), zone) + 1];
}

export { DAY_MS };
