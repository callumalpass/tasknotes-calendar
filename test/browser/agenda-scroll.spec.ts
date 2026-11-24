import { expect, test } from "@playwright/test";
import { item, open } from "./helpers";

for (const height of ["fill", "auto"] as const) {
	test(`upward scrolling extends a ${height} agenda without moving the visible task`, async ({ page }) => {
		await open(page, `view=listWeek&agenda=1&date=2026-10-21&height=${height}`);
		if (height === "auto") {
			await page.addStyleTag({ content: "#side { display: none } #app { height: auto }" });
		}
		const scroller = page.locator(".tnc-list-scroll");
		const sections = scroller.locator(".tnc-list-section[data-date]");
		const opening = item(page, "due-1");
		await expect(opening).toBeInViewport();
		await expect(sections.first()).toHaveAttribute("data-date", "2026-10-21");
		const openingY = (await opening.boundingBox())!.y;
		const original = await page.evaluate(() => window.tnc.calendar.getView());

		await scroller.hover({ position: { x: 100, y: 60 } });
		await page.mouse.wheel(0, -35);
		await expect(sections.first()).toHaveAttribute("data-date", "2026-10-14");
		const range = await page.evaluate(() => window.tnc.calendar.getView());
		expect(range.anchor).toBe(original.anchor);
		expect(range.range.endDay).toBeGreaterThanOrEqual(original.range.endDay);
		expect(range.dataRange.startDay).toBeLessThanOrEqual(range.range.startDay);
		expect(Math.abs((await opening.boundingBox())!.y - openingY)).toBeLessThan(2);

		// The host may load the earlier tasks after rendering the new days.
		await page.evaluate(() => window.tnc.setItems([
			...window.tnc.items(),
			{ id: "earlier", title: "Earlier task", start: "2026-10-14" },
		]));
		const earlier = item(page, "earlier");
		await expect(earlier).toBeAttached();
		expect(Math.abs((await opening.boundingBox())!.y - openingY)).toBeLessThan(2);
		await page.mouse.wheel(0, -2000);
		await expect(earlier).toBeInViewport();
		await expect(sections.first()).toHaveAttribute("data-date", "2026-10-07");
	});
}

test("@touch a downward finger swipe at the opening edge loads earlier days", async ({ page }) => {
	await open(page, "view=listWeek&agenda=1&date=2026-10-21");
	const sections = page.locator(".tnc-list-section[data-date]");
	await expect(sections.first()).toHaveAttribute("data-date", "2026-10-21");
	const box = (await sections.first().boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + 40;
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
	await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 60 }] });
	await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await expect(sections.first()).toHaveAttribute("data-date", "2026-10-14");
});
