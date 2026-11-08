import { expect, test } from "@playwright/test";
import { open, center } from "./helpers";

test("scrollToTime keeps the whole requested hour below sticky headers", async ({ page }) => {
	await open(page, "view=timeGridWeek&date=2026-10-21");
	await page.evaluate(() => { window.tnc.calendar.root.style.height = "500px"; window.tnc.calendar.setOptions({ height: "fill", expandRows: false, slotHeight: 32, slotMinTime: "00:00", slotMaxTime: "24:00" }); });
	await page.evaluate(() => window.tnc.calendar.scrollToTime("08:00"));
	const geometry = await page.locator('.tnc-slot-label').nth(7).evaluate(element => ({
		top: element.getBoundingClientRect().top,
		band: document.querySelector(".tnc-tg-top")!.getBoundingClientRect().bottom,
	}));
	expect(geometry.top).toBeGreaterThanOrEqual(geometry.band);
});

test("passing an edge does not scroll but dwelling does, and Escape restores it", async ({ page }) => {
	await open(page, "view=timeGridWeek&date=2026-10-21");
	await page.evaluate(() => { window.tnc.calendar.root.style.height = "500px"; window.tnc.calendar.setOptions({ height: "fill", expandRows: false, slotHeight: 32, slotMinTime: "00:00", slotMaxTime: "24:00" }); });
	const scroller = page.locator(".tnc-tg-scroll");
	await page.evaluate(() => window.tnc.calendar.scrollToTime("08:00"));
	const item = page.locator('.tnc-item[data-id="scheduled-9"]').first();
	const from = await center(item);
	const viewport = (await scroller.boundingBox())!;
	const before = await scroller.evaluate(element => element.scrollTop);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 3, from.y + 10, { steps: 2 });
	await page.mouse.move(from.x, viewport.y + viewport.height - 6);
	await page.mouse.move(from.x, from.y + 30);
	expect(await scroller.evaluate(element => element.scrollTop)).toBe(before);
	await page.mouse.move(from.x, viewport.y + viewport.height - 6);
	await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	expect(await scroller.evaluate(element => element.scrollTop)).toBe(before);
});
