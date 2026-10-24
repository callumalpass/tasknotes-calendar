import { describe, expect, it } from "vitest";
import { dayFromYMD } from "../../src/core/date";
import { Formatter } from "../../src/dom/format";

describe("Formatter", () => {
	it("formats compact 12-hour and 24-hour times", () => {
		const en = new Formatter("en-US", true);
		expect(en.time(540, true)).toBe("9am");
		expect(en.time(570, true)).toBe("9:30am");
		expect(en.time(13 * 60)).toMatch(/^1:00\s+PM$/u);
		const de = new Formatter("de-DE", false);
		expect(de.time(570)).toBe("09:30");
	});
	it("formats ranges without zone drift", () => {
		const f = new Formatter("en-US", false);
		expect(f.range(dayFromYMD(2026, 10, 19), dayFromYMD(2026, 10, 25))).toMatch(/Oct 19\s*–\s*25, 2026/);
		expect(f.monthYear(dayFromYMD(2026, 10, 1))).toBe("October 2026");
	});
});
