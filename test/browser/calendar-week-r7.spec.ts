import { expect, test } from "@playwright/test";
import { open } from "./helpers";

test("narrow full month keeps indicators on busy and quiet days and restores bars on resize", async ({ page }) => {
	await page.setViewportSize({ width: 400, height: 700 });
	await open(page, "view=dayGridMonth&date=2026-10-21");
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ monthDisplay: "full", dayMaxEvents: true });
		window.tnc.setItems([
			...Array.from({ length: 20 }, (_, index) => ({ id: `busy-${index}`, title: `Busy task ${index}`, start: "2026-10-21" })),
			{ id: "quiet", title: "Quiet day task", start: "2026-10-22" },
		]);
	});
	for (const date of ["2026-10-21", "2026-10-22"]) {
		await expect(page.locator(`.tnc-dg-day[data-date="${date}"] .tnc-item--indicator`).first()).toBeVisible();
	}
	await expect(page.locator('.tnc-dg-day[data-date="2026-10-21"]')).toHaveAttribute("aria-label", /20/);
	await page.setViewportSize({ width: 1400, height: 900 });
	await expect(page.locator(".tnc-dg--dots")).toHaveCount(0);
	await expect(page.locator('.tnc-item--bar[data-id="quiet"]')).toBeVisible();
	await expect(page.locator(".tnc-item--indicator")).toHaveCount(0);
});

test("short narrow events give their title the time label's space without losing accessible times", async ({ page }) => {
	await open(page, "view=timeGridWeek&date=2026-10-21");
	await page.evaluate(() => window.tnc.setItems([
		{ id: "short", title: "Daily standup with the design team", start: "2026-10-21T09:00", end: "2026-10-21T09:15" },
	]));
	const event = page.locator('.tnc-item[data-id="short"]');
	await expect(event.locator(".tnc-item-time")).toBeHidden();
	await expect(event).toHaveAttribute("aria-label", /09:00.*09:15/);
	const titleWidth = await event.locator(".tnc-item-title").evaluate(element => element.getBoundingClientRect().width);
	const eventWidth = await event.evaluate(element => element.getBoundingClientRect().width);
	expect(titleWidth).toBeGreaterThan(eventWidth - 24);
});

test("hour-long events keep their time visible in narrow, busy columns", async ({ page }) => {
	await page.setViewportSize({ width: 1000, height: 800 });
	await open(page, "view=timeGridWeek&date=2026-10-21");
	await page.evaluate(() => window.tnc.setItems([
		{ id: "gym", title: "Gym Workout", start: "2026-10-21T08:00", end: "2026-10-21T09:00" },
		{ id: "long", title: "Exercise (Chest, Shoulders, and Triceps) with a long description", start: "2026-10-21T10:00", end: "2026-10-21T11:00" },
		{ id: "mid", title: "Exercise (Chest, Shoulders, and Triceps) with a long description", start: "2026-10-21T12:00", end: "2026-10-21T12:45" },
	]));
	for (const id of ["gym", "long", "mid"]) {
		const event = page.locator(`.tnc-item[data-id="${id}"]`);
		const time = event.locator(".tnc-item-time");
		await expect(time).toBeVisible();
		await expect(time).not.toBeEmpty();
		const [timeBox, eventBox] = await Promise.all([time.boundingBox(), event.boundingBox()]);
		expect(timeBox!.y + timeBox!.height).toBeLessThanOrEqual(eventBox!.y + eventBox!.height);
	}
});
