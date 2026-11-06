import { test, expect } from "@playwright/test";
import { lastLog, open } from "./helpers";

test("compact month centers its date and activity without replacing date activation", async ({ page }) => {
	await page.setViewportSize({ width: 400, height: 800 });
	await open(page, "view=dayGridMonth&display=dots&tz=Europe%2FLondon");
	await page.evaluate(() => window.tnc.calendar.setOptions({ navLinks: false }));
	await expect(page.locator('.tnc-dg-day[data-date="2026-10-01"] .tnc-dg-num')).toHaveText("1");
	const cell = page.locator('.tnc-dg-day[data-date="2026-10-21"]');
	await expect(cell).toHaveAccessibleName(/items/);
	const geometry = await cell.evaluate(element => {
		const bounds = element.getBoundingClientRect();
		const number = element.querySelector(".tnc-dg-num")!.getBoundingClientRect();
		const dots = element.querySelector(".tnc-dg-dots")!;
		return {
			difference: Math.abs(number.x + number.width / 2 - bounds.x - bounds.width / 2),
			alignment: getComputedStyle(dots).justifyContent,
		};
	});
	expect(geometry.difference).toBeLessThanOrEqual(1);
	expect(geometry.alignment).toBe("center");
	await cell.focus();
	await page.keyboard.press("Enter");
	await expect.poll(() => lastLog(page, "dateclick")).toBe("dateclick 2026-10-21");
});
