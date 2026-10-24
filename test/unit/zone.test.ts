import { describe, expect, it } from "vitest";
import { dayFromYMD, formatDay, isoWeekNumber, addMonths, parseDay, weekdayOf, startOfWeek } from "../../src/core/date";
import { dayLengthMinutes, formatFloating, getTimeZone, parseDateInput, toInstant, wallTime } from "../../src/core/zone";

describe("civil days", () => {
	it("round-trips and knows weekdays", () => {
		const d = dayFromYMD(2026, 10, 24);
		expect(formatDay(d)).toBe("2026-10-24");
		expect(weekdayOf(d)).toBe(6);
		expect(formatDay(startOfWeek(d, 1))).toBe("2026-10-19");
		expect(formatDay(startOfWeek(d, 0))).toBe("2026-10-18");
		expect(parseDay("2026-02-30")).toBeNull();
	});
	it("clamps month arithmetic", () => {
		expect(formatDay(addMonths(dayFromYMD(2026, 1, 31), 1))).toBe("2026-02-28");
		expect(formatDay(addMonths(dayFromYMD(2024, 1, 31), 1))).toBe("2024-02-29");
		expect(formatDay(addMonths(dayFromYMD(2026, 1, 15), -2))).toBe("2025-11-15");
	});
	it("computes ISO weeks", () => {
		expect(isoWeekNumber(dayFromYMD(2026, 1, 1))).toBe(1);
		expect(isoWeekNumber(dayFromYMD(2021, 1, 3))).toBe(53);
	});
});

describe("IANA zones across DST", () => {
	const ny = getTimeZone("America/New_York");
	const syd = getTimeZone("Australia/Sydney");
	it("knows 23h and 25h days", () => {
		expect(dayLengthMinutes(dayFromYMD(2026, 3, 8), ny)).toBe(1380);
		expect(dayLengthMinutes(dayFromYMD(2026, 11, 1), ny)).toBe(1500);
		expect(dayLengthMinutes(dayFromYMD(2026, 10, 4), syd)).toBe(1380);
		expect(dayLengthMinutes(dayFromYMD(2026, 4, 5), syd)).toBe(1500);
		expect(dayLengthMinutes(dayFromYMD(2026, 6, 1), ny)).toBe(1440);
	});
	it("moves gap times forward and keeps wall time otherwise", () => {
		const d = dayFromYMD(2026, 3, 8);
		const gap = toInstant(d, 150, ny); // 02:30 does not exist
		expect(wallTime(gap, ny)).toEqual({ day: d, minute: 210 });
		const after = toInstant(d, 600, ny);
		expect(new Date(after).toISOString()).toBe("2026-03-08T14:00:00.000Z");
	});
	it("parses floating, dated and absolute input", () => {
		expect(parseDateInput("2026-10-24", ny)).toEqual({ kind: "day", day: dayFromYMD(2026, 10, 24) });
		const f = parseDateInput("2026-07-01T09:30", ny);
		expect(f && f.kind === "instant" && new Date(f.ms).toISOString()).toBe("2026-07-01T13:30:00.000Z");
		const z = parseDateInput("2026-07-01T09:30:00Z", ny);
		expect(z && z.kind === "instant" && z.ms).toBe(Date.UTC(2026, 6, 1, 9, 30));
		expect(formatFloating(Date.UTC(2026, 6, 1, 13, 30), ny)).toBe("2026-07-01T09:30");
	});
});
