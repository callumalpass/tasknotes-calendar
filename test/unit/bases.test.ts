import { describe, expect, it } from "vitest";
import { basesLayoutOptions } from "../../src/tasknotes/bases";

describe("basesLayoutOptions", () => {
	it("defaults the time grid scale and pinch", () => {
		expect(basesLayoutOptions({})).toMatchObject({ slotHeight: 24, pinchZoom: true });
	});

	it("rounds and clamps slot heights, ignoring values that are not numbers", () => {
		expect(basesLayoutOptions({ slotHeight: 37.6 }).slotHeight).toBe(38);
		expect(basesLayoutOptions({ slotHeight: 1 }).slotHeight).toBe(5);
		expect(basesLayoutOptions({ slotHeight: 400 }).slotHeight).toBe(96);
		expect(basesLayoutOptions({ slotHeight: "tall" as unknown as number }).slotHeight).toBe(24);
	});

	it("turns pinch off only when asked", () => {
		expect(basesLayoutOptions({ pinchZoom: false }).pinchZoom).toBe(false);
		expect(basesLayoutOptions({ pinchZoom: null }).pinchZoom).toBe(true);
	});
});
