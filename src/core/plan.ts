import type { Day } from "./date";
import type { ItemStore } from "./store";
import type { NormalizedItem } from "./types";
import { toInstant, type TimeZone } from "./zone";

/** Minutes of planned (timed, plan-lane, non-background) work on each day. */
export function plannedMinutes<D>(store: ItemStore<D>, days: Day[]): Map<Day, number> {
	const zone = store.timeZone;
	const out = new Map<Day, number>();
	for (const day of days) {
		const start = toInstant(day, 0, zone);
		const end = toInstant(day + 1, 0, zone);
		let total = 0;
		for (const n of store.timedOn(day)) {
			if (n.item.display === "background" || n.item.lane === "actual") continue;
			total += Math.max(0, Math.min(n.endMs, end) - Math.max(n.startMs, start)) / 60_000;
		}
		out.set(day, total);
	}
	return out;
}

/** Items that start before something they depend on has finished. */
export function dependencyConflicts<D>(store: ItemStore<D>): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const n of store.all()) {
		for (const dep of n.item.dependsOn ?? []) {
			const d = store.get(dep);
			if (!d || d.endMs <= n.startMs) continue;
			const list = out.get(n.id) ?? [];
			list.push(dep);
			out.set(n.id, list);
		}
	}
	return out;
}

export interface SlotSearch {
	/** First and last (exclusive) days to search. */
	fromDay: Day;
	toDay: Day;
	durationMinutes: number;
	/** Working window as wall minutes, e.g. [540, 1020] for 09:00-17:00. */
	window: [number, number];
	/** Don't place anything before this instant (usually now). */
	notBefore?: number;
	snapMinutes?: number;
	/** Items to treat as free time, e.g. the item being placed. */
	ignore?: (n: NormalizedItem) => boolean;
	/** Days to skip, e.g. weekends. */
	skipDay?: (day: Day) => boolean;
}

/** Finds the first gap long enough for `durationMinutes` in the working window. */
export function findFreeSlot<D>(store: ItemStore<D>, q: SlotSearch): { startMs: number; endMs: number } | null {
	const zone: TimeZone = store.timeZone;
	const snap = (q.snapMinutes ?? 15) * 60_000;
	const need = q.durationMinutes * 60_000;
	for (let day = q.fromDay; day < q.toDay; day++) {
		if (q.skipDay?.(day)) continue;
		const winStart = toInstant(day, q.window[0], zone);
		const winEnd = toInstant(day, q.window[1], zone);
		const busy = store
			.timedOn(day)
			.filter((n) => n.item.display !== "background" && n.item.lane !== "actual" && !(q.ignore?.(n as NormalizedItem) ?? false))
			.map((n) => [n.startMs, n.endMs] as const)
			.sort((a, b) => a[0] - b[0]);
		let cursor = Math.max(winStart, q.notBefore ?? -Infinity);
		cursor = Math.ceil(cursor / snap) * snap;
		for (const [s, e] of busy) {
			if (e <= cursor) continue;
			if (s - cursor >= need && cursor + need <= winEnd) return { startMs: cursor, endMs: cursor + need };
			cursor = Math.max(cursor, Math.ceil(e / snap) * snap);
			if (cursor >= winEnd) break;
		}
		if (cursor + need <= winEnd) return { startMs: cursor, endMs: cursor + need };
	}
	return null;
}
