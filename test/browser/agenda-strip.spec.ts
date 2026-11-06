import { test, expect } from "@playwright/test";
import { open } from "./helpers";

test("agenda strip has one accessible expansion control and preserves keyboard date navigation", async ({ page }) => {
	await open(page, "view=listWeek&tz=Europe%2FLondon");
	await page.evaluate(() => window.tnc.calendar.setOptions({ listAgenda: true }));
	const strip = page.locator(".tnc-strip");
	const toggle = strip.locator(".tnc-strip-title");
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await expect(strip.locator("button[aria-hidden='true']")).toHaveCount(0);
	await toggle.focus();
	await page.keyboard.press("Enter");
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	const selected = strip.locator("[aria-pressed='true']");
	await selected.focus();
	const original = await selected.getAttribute("data-date");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Enter");
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await expect(strip.locator("[aria-pressed='true']")).not.toHaveAttribute("data-date", original!);
});

test("agenda paging moves the list and scrollbar movement updates the strip", async ({ page }) => {
	await open(page, "view=listWeek&date=2026-10-21&tz=Europe%2FLondon");
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ listAgenda: true, height: "fill" });
		window.tnc.setItems(Array.from({ length: 28 }, (_, offset) => ({
			id: `day-${offset}`, title: `Appointment ${offset}`,
			color: "#b32980",
			start: new Date(2026, 9, 21 + offset, 9), end: new Date(2026, 9, 21 + offset, 10),
		})));
	});
	await page.locator(".tnc-strip-next").click();
	await expect(page.locator(".tnc-strip-day.is-focus .tnc-strip-dot")).toHaveCSS("background-color", "rgb(179, 41, 128)");
	await expect(page.locator(".tnc-strip-day.is-focus")).toHaveAttribute("data-date", "2026-10-28");
	const topDay = () => page.evaluate(() => {
		const scroll = document.querySelector(".tnc-list-scroll")!;
		const edge = scroll.getBoundingClientRect().top + 1;
		return [...scroll.querySelectorAll<HTMLElement>(".tnc-list-section")].find(section => section.getBoundingClientRect().bottom > edge)?.dataset.date;
	});
	await expect.poll(topDay).toBe("2026-10-28");
	await page.locator(".tnc-list-scroll").evaluate(element => { element.scrollTop += 400; });
	await expect.poll(async () => page.locator(".tnc-strip-day.is-focus").getAttribute("data-date")).not.toBe("2026-10-28");
	await expect.poll(async () => ({ focus: await page.locator(".tnc-strip-day.is-focus").getAttribute("data-date"), top: await topDay() })).toEqual({ focus: await topDay(), top: await topDay() });
});
