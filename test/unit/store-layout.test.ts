import { describe, expect, it } from "vitest";
import { dayFromYMD } from "../../src/core/date";
import { layoutRow, layoutTimedDay, packTimed, segmentOn } from "../../src/core/layout";
import { ItemStore } from "../../src/core/store";
import { getTimeZone } from "../../src/core/zone";

const zone = getTimeZone("Europe/London");
const D = dayFromYMD(2026, 10, 20);

describe("ItemStore", () => {
	it("indexes items by day and reports only what changed", () => {
		const s = new ItemStore(zone);
		const c1 = s.setAll([
			{ id: "a", title: "A", start: "2026-10-20T09:00", end: "2026-10-20T10:00" },
			{ id: "b", title: "B", start: "2026-10-21T09:00" },
			{ id: "c", title: "C", start: "2026-10-20", end: "2026-10-23" },
		]);
		expect(c1.added).toHaveLength(3);
		expect([...c1.days].sort()).toEqual([D, D + 1]);
		expect(s.timedOn(D).map((n) => n.id)).toEqual(["a"]);
		expect(s.get("b")!.endMs - s.get("b")!.startMs).toBe(3_600_000);
		expect(s.get("c")!.allDay).toBe(true);
		expect(s.get("c")!.endDay).toBe(D + 3);

		const c2 = s.setAll([
			{ id: "a", title: "A", start: "2026-10-20T09:00", end: "2026-10-20T10:00" },
			{ id: "b", title: "B", start: "2026-10-22T09:00" },
			{ id: "c", title: "C", start: "2026-10-20", end: "2026-10-23" },
		]);
		expect(c2.updated).toEqual(["b"]);
		expect([...c2.days].sort()).toEqual([D + 1, D + 2]);
		expect(c2.added).toEqual([]);

		const c3 = s.setAll([{ id: "a", title: "A", start: "2026-10-20T09:00", end: "2026-10-20T10:00" }]);
		expect(c3.removed.sort()).toEqual(["b", "c"]);
	});

	it("splits items that cross midnight", () => {
		const s = new ItemStore(zone);
		s.setAll([{ id: "m", title: "Migration", start: "2026-10-20T22:30", end: "2026-10-21T01:15" }]);
		expect(s.timedOn(D).length).toBe(1);
		expect(s.timedOn(D + 1).length).toBe(1);
		const n = s.get("m")!;
		expect(segmentOn(n, D, zone)).toMatchObject({ startMin: 1350, endMin: 1440, isStart: true, isEnd: false });
		expect(segmentOn(n, D + 1, zone)).toMatchObject({ startMin: 0, endMin: 75, isStart: false, isEnd: true });
	});

	it("uses rev to skip serialisation", () => {
		const s = new ItemStore(zone);
		s.setAll([{ id: "a", title: "A", start: "2026-10-20T09:00", rev: 1, data: { x: 1 } }]);
		const c = s.setAll([{ id: "a", title: "A", start: "2026-10-20T09:00", rev: 1, data: { x: 2 } }]);
		expect(c.updated).toEqual([]);
	});
});

describe("time grid packing", () => {
	it("gives overlapping items columns and lets free items stretch", () => {
		const s = new ItemStore(zone);
		s.setAll([
			{ id: "a", title: "A", start: "2026-10-20T09:00", end: "2026-10-20T11:00" },
			{ id: "b", title: "B", start: "2026-10-20T09:30", end: "2026-10-20T10:00" },
			{ id: "c", title: "C", start: "2026-10-20T10:00", end: "2026-10-20T10:30" },
			{ id: "d", title: "D", start: "2026-10-20T09:15", end: "2026-10-20T09:45" },
			{ id: "e", title: "E", start: "2026-10-20T13:00", end: "2026-10-20T14:00" },
		]);
		const L = layoutTimedDay(s.timedOn(D), D, zone, 15);
		const by = Object.fromEntries(L.plan.map((p) => [p.item.id, p]));
		expect(by.a).toMatchObject({ col: 0, cols: 3 });
		expect(by.d).toMatchObject({ col: 1 });
		expect(by.b).toMatchObject({ col: 2 });
		expect(by.c).toMatchObject({ col: 1, span: 2 });
		expect(by.e).toMatchObject({ col: 0, cols: 1, span: 1 });
	});
	it("treats short items as at least minMinutes tall", () => {
		const s = new ItemStore(zone);
		s.setAll([
			{ id: "a", title: "A", start: "2026-10-20T09:00", end: "2026-10-20T09:05" },
			{ id: "b", title: "B", start: "2026-10-20T09:10", end: "2026-10-20T09:20" },
		]);
		const segs = s.timedOn(D).map((n) => segmentOn(n, D, zone)!);
		expect(packTimed(segs, 5).every((p) => p.cols === 1)).toBe(true);
		expect(packTimed(segs, 30).every((p) => p.cols === 2)).toBe(true);
	});
});

describe("row layout", () => {
	it("stacks spans and clips hidden days", () => {
		const s = new ItemStore(zone);
		s.setAll([
			{ id: "long", title: "Long", start: "2026-10-19", end: "2026-10-26" },
			{ id: "x", title: "X", start: "2026-10-20" },
			{ id: "y", title: "Y", start: "2026-10-20" },
			{ id: "wkend", title: "Weekend", start: "2026-10-24", end: "2026-10-26" },
		]);
		const weekdays = [0, 1, 2, 3, 4].map((i) => dayFromYMD(2026, 10, 19) + i);
		const L = layoutRow(s.spanningIn(weekdays[0]!, weekdays[4]! + 1, true), weekdays);
		const by = Object.fromEntries(L.placements.map((p) => [p.item.id, p]));
		expect(by.long).toMatchObject({ startCol: 0, endCol: 5, level: 0, isEnd: false });
		expect(by.x!.level).toBe(1);
		expect(by.y!.level).toBe(2);
		expect(by.wkend).toBeUndefined();
		expect(L.countByCol).toEqual([1, 3, 1, 1, 1]);
	});
});
