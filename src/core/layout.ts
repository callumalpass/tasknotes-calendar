import { type Day, MINUTES_PER_DAY } from "./date";
import type { NormalizedItem } from "./types";
import { type TimeZone, toInstant, wallTime } from "./zone";

/* ---------------------------------------------------------------- time grid */

export interface TimedSegment<D = unknown> {
	item: NormalizedItem<D>;
	day: Day;
	/** Wall-clock minutes from local midnight. `endMin` may be 1440. */
	startMin: number;
	endMin: number;
	/** Whether the item starts / ends inside this day. */
	isStart: boolean;
	isEnd: boolean;
}

export interface TimedPlacement<D = unknown> extends TimedSegment<D> {
	/** Column within its overlap cluster, and the cluster's column count. */
	col: number;
	cols: number;
	/** Columns the item can stretch across without hitting a neighbour. */
	span: number;
	/** Index of the overlap cluster within the day. */
	cluster: number;
	/**
	 * Whether the cluster overlaps an item in the other lane (plan vs actual).
	 * Only then does the item keep to its lane's share of the column.
	 */
	split: boolean;
	/**
	 * Another item starts exactly where this short one ends, so it is drawn at
	 * its real height instead of being stretched to the minimum height.
	 */
	abutted?: boolean;
}

export interface TimedDayLayout<D = unknown> {
	day: Day;
	plan: TimedPlacement<D>[];
	actual: TimedPlacement<D>[];
	background: TimedSegment<D>[];
}

export function segmentOn<D>(n: NormalizedItem<D>, day: Day, zone: TimeZone): TimedSegment<D> | null {
	return segmentInWindow(n, day, 0, MINUTES_PER_DAY, zone);
}

/**
 * Clips an item to the wall-clock window [minMinute, maxMinute) of `day`.
 * The window may run past midnight (maxMinute up to 2880) for grids that show
 * "48:00"-style ranges. Returned minutes are relative to `day`'s midnight.
 */
export function segmentInWindow<D>(
	n: NormalizedItem<D>,
	day: Day,
	minMinute: number,
	maxMinute: number,
	zone: TimeZone,
): TimedSegment<D> | null {
	const winStart = toInstant(day, minMinute, zone);
	const winEnd = toInstant(day, maxMinute, zone);
	const s = Math.max(n.startMs, winStart);
	const e = Math.min(n.endMs, winEnd);
	const zeroLength = n.startMs === n.endMs && n.startMs >= winStart && n.startMs < winEnd;
	if (e <= s && !zeroLength) return null;
	const rel = (ms: number) => {
		const w = wallTime(ms, zone);
		return (w.day - day) * MINUTES_PER_DAY + w.minute;
	};
	const startMin = s === winStart ? minMinute : rel(s);
	let endMin = e === winEnd ? maxMinute : rel(e);
	// A fall-back day repeats an hour; keep segments non-negative.
	if (endMin < startMin) endMin = Math.min(maxMinute, startMin + Math.round((e - s) / 60_000));
	return {
		item: n,
		day,
		startMin,
		endMin,
		isStart: n.startMs >= winStart,
		isEnd: n.endMs <= winEnd,
	};
}

export type ItemOrder<D = unknown> = (a: NormalizedItem<D>, b: NormalizedItem<D>) => number;

/** FullCalendar's default: start, longer first, all-day first, title. */
export const defaultOrder: ItemOrder = (a, b) =>
	a.startMs - b.startMs ||
	b.endMs - b.startMs - (a.endMs - a.startMs) ||
	Number(b.allDay) - Number(a.allDay) ||
	a.item.title.localeCompare(b.item.title);

/**
 * Whether `b`, starting no earlier than `a`, collides with `a`. Short items count
 * as `minMinutes` tall, so a later item inside that displayed height collides,
 * but one starting exactly at `a`'s end does not: back-to-back items tile the
 * column, and `a` is drawn at its real height.
 */
function collides(a: TimedSegment, b: TimedSegment, minMinutes: number): boolean {
	if (b.startMin < a.endMin) return true;
	if (b.startMin === a.endMin && a.endMin > a.startMin) return false;
	return b.startMin < a.startMin + minMinutes;
}

/** Whether two segments collide, in either order. */
function overlaps(a: TimedSegment, b: TimedSegment, minMinutes: number): boolean {
	return a.startMin <= b.startMin ? collides(a, b, minMinutes) : collides(b, a, minMinutes);
}

/**
 * Packs overlapping segments into columns. Items in the same overlap cluster
 * share a column count; each item stretches right until it meets an overlapping
 * neighbour.
 */
export function packTimed<D>(segs: TimedSegment<D>[], minMinutes: number, order: ItemOrder<D> = defaultOrder): TimedPlacement<D>[] {
	const sorted = [...segs].sort((a, b) =>
		a.startMin - b.startMin ||
		Math.max(b.endMin, b.startMin + minMinutes) - Math.max(a.endMin, a.startMin + minMinutes) ||
		order(a.item, b.item));
	const out: TimedPlacement<D>[] = [];
	let cluster: TimedPlacement<D>[] = [];
	/** The last item placed in each column of the current cluster. */
	let colLast: TimedPlacement<D>[] = [];
	let clusterIndex = 0;
	const flush = () => {
		if (cluster.length) clusterIndex++;
		const cols = colLast.length;
		for (const p of cluster) {
			p.cols = cols;
			let span = 1;
			while (p.col + span < cols && !cluster.some((o) => o.col === p.col + span && overlaps(o, p, minMinutes))) span++;
			p.span = span;
		}
		cluster = [];
		colLast = [];
	};
	for (const s of sorted) {
		if (!cluster.some((o) => collides(o, s, minMinutes))) flush();
		let col = colLast.findIndex((last) => !collides(last, s, minMinutes));
		if (col < 0) col = colLast.length;
		const p: TimedPlacement<D> = { ...s, col, cols: 1, span: 1, cluster: clusterIndex, split: false };
		colLast[col] = p;
		cluster.push(p);
		out.push(p);
	}
	flush();
	const starts = new Set(out.map((p) => p.startMin));
	for (const p of out) if (p.endMin > p.startMin && p.startMin + minMinutes > p.endMin && starts.has(p.endMin)) p.abutted = true;
	return out;
}

export function layoutTimedDay<D>(
	items: NormalizedItem<D>[],
	day: Day,
	zone: TimeZone,
	minMinutes: number,
	order?: ItemOrder<D>,
	window: [number, number] = [0, MINUTES_PER_DAY],
): TimedDayLayout<D> {
	const plan: TimedSegment<D>[] = [];
	const actual: TimedSegment<D>[] = [];
	const background: TimedSegment<D>[] = [];
	for (const n of items) {
		const seg = segmentInWindow(n, day, window[0], window[1], zone);
		if (!seg) continue;
		if (n.item.display === "background") background.push(seg);
		else if (n.item.lane === "actual") actual.push(seg);
		else plan.push(seg);
	}
	const planPlaced = packTimed(plan, minMinutes, order);
	const actualPlaced = packTimed(actual, minMinutes, order);
	markSplit(planPlaced, actualPlaced, minMinutes);
	markSplit(actualPlaced, planPlaced, minMinutes);
	return { day, plan: planPlaced, actual: actualPlaced, background };
}

/** Marks clusters of `lane` that overlap any item of `other`, at displayed (min) heights. */
function markSplit<D>(lane: TimedPlacement<D>[], other: TimedPlacement<D>[], minMinutes: number): void {
	if (!lane.length || !other.length) return;
	const split = new Set<number>();
	for (const p of lane) if (!split.has(p.cluster) && other.some((o) => overlaps(p, o, minMinutes))) split.add(p.cluster);
	for (const p of lane) p.split = split.has(p.cluster);
}

/* ----------------------------------------------------------------- day rows */

export interface RowPlacement<D = unknown> {
	item: NormalizedItem<D>;
	/** Column range within the row, end exclusive. */
	startCol: number;
	endCol: number;
	level: number;
	/** False when the item continues before / after the row. */
	isStart: boolean;
	isEnd: boolean;
}

export interface RowLayout<D = unknown> {
	placements: RowPlacement<D>[];
	/** Number of placements per column (for "+N more"). */
	countByCol: number[];
	levels: number;
}

/**
 * Lays out items across a row of day columns (a month week, or the all-day
 * row of a time grid). `days` are the visible days in order; hidden days are
 * simply absent, and items spanning them are clipped.
 */
export function layoutRow<D>(items: NormalizedItem<D>[], days: Day[], order: ItemOrder<D> = defaultOrder): RowLayout<D> {
	const first = days[0];
	const last = days[days.length - 1];
	const countByCol = new Array<number>(days.length).fill(0);
	if (first === undefined || last === undefined) return { placements: [], countByCol, levels: 0 };
	const colOf = (d: Day): number => {
		// First column whose day is >= d.
		let lo = 0;
		let hi = days.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (days[mid]! < d) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	};
	const sorted = items
		.filter((n) => n.startDay <= last && n.endDay > first)
		.sort((a, b) => {
			const sa = Math.max(a.startDay, first);
			const sb = Math.max(b.startDay, first);
			return sa - sb || b.endDay - b.startDay - (a.endDay - a.startDay) || order(a, b);
		});
	const levelEnds: number[][] = []; // per level: occupied columns
	const placements: RowPlacement<D>[] = [];
	for (const n of sorted) {
		const startCol = colOf(n.startDay);
		const endCol = colOf(n.endDay);
		if (endCol <= startCol) continue; // only covers hidden days
		let level = 0;
		for (; ; level++) {
			const occ = (levelEnds[level] ??= []);
			let free = true;
			for (let c = startCol; c < endCol; c++) if (occ[c]) free = false;
			if (free) {
				for (let c = startCol; c < endCol; c++) occ[c] = 1;
				break;
			}
		}
		for (let c = startCol; c < endCol; c++) countByCol[c]!++;
		placements.push({
			item: n,
			startCol,
			endCol,
			level,
			isStart: n.startDay >= days[startCol]!,
			isEnd: n.endDay <= days[endCol - 1]! + 1,
		});
	}
	return { placements, countByCol, levels: levelEnds.length };
}

/* ----------------------------------------------------------------- timeline */

export interface TimelineBar<D = unknown> {
	item: NormalizedItem<D>;
	/** Ms range clipped to the visible window. */
	startMs: number;
	endMs: number;
	clippedStart: boolean;
	clippedEnd: boolean;
	/** Sub-row within the lane when bars overlap. */
	level: number;
}

/** Stacks overlapping bars within one lane. */
export function layoutLane<D>(items: NormalizedItem<D>[], windowStart: number, windowEnd: number): { bars: TimelineBar<D>[]; levels: number } {
	const sorted = items
		.filter((n) => n.endMs > windowStart && n.startMs < windowEnd)
		.sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
	const levelEnds: number[] = [];
	const bars: TimelineBar<D>[] = [];
	for (const n of sorted) {
		let level = levelEnds.findIndex((end) => end <= n.startMs);
		if (level < 0) {
			level = levelEnds.length;
			levelEnds.push(0);
		}
		levelEnds[level] = Math.max(n.endMs, n.startMs + 1);
		bars.push({
			item: n,
			startMs: Math.max(n.startMs, windowStart),
			endMs: Math.min(n.endMs, windowEnd),
			clippedStart: n.startMs < windowStart,
			clippedEnd: n.endMs > windowEnd,
			level,
		});
	}
	return { bars, levels: levelEnds.length };
}
