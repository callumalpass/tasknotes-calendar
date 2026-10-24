import { describe, expect, it } from "vitest";
import { dependencyConflicts } from "../../src/core/plan";
import { ItemStore } from "../../src/core/store";
import { getTimeZone } from "../../src/core/zone";

describe("dependencyConflicts", () => {
	it("checks the edges each relationship type names", () => {
		const s = new ItemStore(getTimeZone("UTC"));
		// pred runs 1st-5th; succ runs 3rd-7th, overlapping it.
		const succ = (id: string, type?: "FS" | "SS" | "FF" | "SF") => ({ id, title: id, start: "2026-10-03", end: "2026-10-08", dependsOn: [type ? { id: "pred", type } : "pred"] });
		s.setAll([
			{ id: "pred", title: "pred", start: "2026-10-01", end: "2026-10-06" },
			succ("plain"),
			succ("fs", "FS"),
			succ("ss", "SS"),
			succ("ff", "FF"),
			succ("sf", "SF"),
			{ id: "ff-early", title: "x", start: "2026-10-02", end: "2026-10-04", dependsOn: [{ id: "pred", type: "FF" }] },
		]);
		expect([...dependencyConflicts(s).keys()].sort()).toEqual(["ff-early", "fs", "plain"]);
	});
});
