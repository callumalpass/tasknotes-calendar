import { expect, test } from "@playwright/test";
import { open } from "./helpers";

test("month focus carries into the next view without replacing the focused cell", async ({ page }) => {
	await open(page, "view=dayGridMonth&date=2026-10-21");
	await page.evaluate(() => window.tnc.calendar.setOptions({ monthDisplay: "chips" }));
	const day = page.locator('.tnc-dg-day[data-date="2026-10-10"]');
	await day.focus();
	await page.evaluate(() => window.tnc.calendar.gotoDate("2026-10-10"));
	await expect(day).toBeFocused();
	await page.evaluate(() => window.tnc.calendar.changeView("day"));
	expect(await page.evaluate(() => window.tnc.calendar.getDate().getDate())).toBe(10);
});

test("compact chips preserve task and event identity, count overflow and use one day target", async ({ page }) => {
	await open(page, "view=dayGridMonth&date=2026-10-21");
	await page.setViewportSize({ width: 400, height: 700 });
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ monthDisplay: "chips", dayMaxEvents: true });
		window.tnc.setItems(Array.from({ length: 20 }, (_, index) => ({ id: `chip-${index}`, title: `Identifiable task ${index}`, start: "2026-10-21", color: index % 2 ? "#e0cc32" : "#245fc7" })));
	});
	const day = page.locator('.tnc-dg-day[data-date="2026-10-21"]');
	const chips = day.locator(".tnc-item--indicator");
	await expect(chips.first().locator(".tnc-item-title")).toBeVisible();
	expect(await chips.count()).toBeGreaterThan(0);
	const count = Number((await day.locator(".tnc-dg-dots-more").innerText()).slice(1));
	expect((await chips.count()) + count).toBe(20);
	await expect(day).toHaveAttribute("aria-label", /20/);
	await expect(day.locator("button")).toHaveCount(0);
	await day.focus();
	await page.keyboard.press("Enter");
	await expect(day).toBeFocused();
	expect(await chips.first().locator(".tnc-item-title").evaluate(element => getComputedStyle(element).textOverflow)).toBe("clip");
});

test("point-in-time labels omit synthetic ends without changing hit size or event data", async ({ page }) => {
	await open(page, "view=timeGridDay&date=2026-10-21");
	await page.evaluate(() => window.tnc.setItems([
		{ id: "deadline", title: "Exact deadline", start: "2026-10-21T10:00", timeDisplay: "start" },
		{ id: "meeting", title: "Actual duration", start: "2026-10-21T12:00", end: "2026-10-21T13:00" },
	]));
	const deadline = page.locator('.tnc-item[data-id="deadline"]');
	await expect(deadline).toHaveAttribute("aria-label", /10:00$/);
	await expect(deadline.locator(".tnc-item-time")).toHaveText("10:00");
	const bounds = await deadline.boundingBox();
	expect(bounds!.height).toBeGreaterThan(0);
	await expect(page.locator('.tnc-item[data-id="meeting"]')).toHaveAttribute("aria-label", /12:00 – 13:00/);
	await page.evaluate(() => window.tnc.calendar.changeView("list"));
	await expect(page.locator('.tnc-item[data-id="deadline"] .tnc-item-time')).toHaveText("10:00");
});
