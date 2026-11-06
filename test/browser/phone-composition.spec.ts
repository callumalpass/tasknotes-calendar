import { expect, test } from "@playwright/test";
import { open } from "./helpers";

test("toolbar chooses its native select from its allocated width, not the full calendar", async ({ page }) => {
	await open(page, "view=listWeek&date=2026-10-21");
	await page.addStyleTag({ content: ".tnc-toolbar { width: 120px; } .tnc-toolbar-start { display: none; }" });
	await page.evaluate(() => window.tnc.calendar.setOptions({ toolbar: { views: ["year", "month", "week", "days", "day", "list"] } }));
	await expect(page.locator(".tnc-toolbar-view-select")).toBeVisible();
	await expect(page.locator(".tnc-toolbar-views")).toBeHidden();
	await page.addStyleTag({ content: ".tnc-toolbar { width: 100%; }" });
	await expect(page.locator(".tnc-toolbar-views")).toBeVisible();
	await expect(page.locator(".tnc-toolbar-view-select")).toBeHidden();
});

test("agenda data range covers preceding strip days and requests an expanded month", async ({ page }) => {
	await open(page, "view=listWeek&date=2026-10-21");
	await page.evaluate(() => window.tnc.calendar.setOptions({ listAgenda: true, firstDay: 1 }));
	const range = await page.evaluate(() => {
		const view = window.tnc.calendar.getView();
		return { start: view.dataRange.startDay, visibleStart: view.range.startDay };
	});
	expect(range.start).toBe(Date.parse("2026-10-19T00:00:00Z") / 86400000);
	expect(range.visibleStart).toBe(Date.parse("2026-10-21T00:00:00Z") / 86400000);
	await page.locator(".tnc-strip-title").click();
	const first = await page.locator(".tnc-strip-day").first().getAttribute("data-date");
	const start = await page.evaluate(() => window.tnc.calendar.getView().dataRange.startDay);
	const firstDay = Date.parse(`${first}T00:00:00Z`) / 86400000;
	expect(start).toBeLessThanOrEqual(firstDay);
});
