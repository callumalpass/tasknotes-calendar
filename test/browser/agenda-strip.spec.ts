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
