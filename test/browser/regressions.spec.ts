import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { item, lastLog, open } from "./helpers";

const views = [
	["week", "timeGridWeek"],
	["month", "dayGridMonth"],
	["month-dots", "dayGridMonth&display=dots"],
	["list", "listWeek"],
	["year", "multiMonthYear"],
	["timeline", "timeline"],
] as const;

for (const [name, query] of views) {
	test(`${name}: visual baseline and accessible structure`, async ({ page }) => {
		await open(page, `view=${query}&date=2026-10-21&tz=Europe%2FLondon&locale=en-GB`);
		await expect(page.locator(".tnc-item, .tnc-ym-day").first()).toBeAttached();
		await expect(page.locator(".tnc")).toHaveScreenshot(`${name}.png`, { animations: "disabled" });
		// Structural ARIA and accessible names, not a claim of full WCAG conformance.
		const results = await new AxeBuilder({ page }).include(".tnc").withRules([
			"aria-allowed-attr", "aria-allowed-role", "aria-required-attr",
			"aria-required-children", "aria-required-parent", "aria-valid-attr",
			"aria-valid-attr-value", "button-name",
		]).analyze();
		expect(results.violations).toEqual([]);
		if (name === "week") {
			await expect(page.getByRole("table")).toHaveAccessibleName(/Oct.*2026/);
			await expect(page.locator(".tnc-dh")).toHaveCount(7);
			await expect(page.locator(".tnc-dh").first()).toHaveAccessibleName(/19 October 2026/);
		} else if (name.startsWith("month")) {
			await expect(page.getByRole("grid")).toHaveAccessibleName("October 2026");
			await expect(page.getByRole("columnheader")).toHaveCount(7);
		}
	});
}

for (const [name, query] of views.filter(([name]) => !["month-dots", "year"].includes(name))) {
	test(`${name}: items reachable and operable by keyboard`, async ({ page }) => {
		await open(page, `view=${query}&date=2026-10-21&tz=Europe%2FLondon&locale=en-GB`);
		const id = name === "timeline" ? "p-web-research" : name === "list" ? "due-1" : "scheduled-1";
		const target = item(page, id);
		await expect(target).toHaveRole("button");
		await expect(target).toHaveAccessibleName(/2026/);
		// Reach the actual item through sequential keyboard navigation, not focus().
		for (let i = 0; i < 100 && !(await target.evaluate((el) => el === el.ownerDocument.activeElement)); i++) {
			await page.keyboard.press("Tab");
		}
		await expect(target).toBeFocused();
		await page.keyboard.press("Enter");
		await expect.poll(() => lastLog(page, "click")).toBe(`click ${id}`);
		await page.keyboard.press("Space");
		expect((await page.evaluate(() => window.tnc.log.filter((s) => s.startsWith("click ")).length))).toBe(2);
		await page.keyboard.press("Shift+F10");
		await expect.poll(() => lastLog(page, "contextmenu")).toBe(`contextmenu ${id}`);
		// The agenda is intentionally read-only; activation/context menus still work.
		if (name === "list") return;
		await page.keyboard.press("Alt+ArrowRight");
		await expect.poll(() => lastLog(page, "drop")).toContain(`drop ${id} `);
		await expect(target).toBeFocused();
		await page.keyboard.press("Alt+Shift+ArrowRight");
		await expect.poll(() => lastLog(page, "resize")).toContain(`resize ${id} `);
		await expect(target).toBeFocused();
	});
}

test("summary views: date activation without a pointer", async ({ page }) => {
	await open(page, "view=dayGridMonth&display=dots&tz=Europe%2FLondon");
	await page.evaluate(() => window.tnc.calendar.setOptions({ navLinks: false }));
	const cell = page.getByRole("gridcell", { name: /21 October 2026/ });
	await expect(cell).toHaveAccessibleName(/items/);
	await cell.focus();
	await page.keyboard.press("Enter");
	await expect.poll(() => lastLog(page, "dateclick")).toBe("dateclick 2026-10-21");
	await open(page, "view=multiMonthYear&tz=Europe%2FLondon");
	const day = page.locator('.tnc-ym-day[data-date="2026-10-21"]');
	await expect(day).toHaveAccessibleName(/items/);
	await day.focus();
	await page.keyboard.press("Space");
	await expect.poll(() => lastLog(page, "dateclick")).toBe("dateclick 2026-10-21");
});

test("week: narrow containers scroll sideways instead of crushing day columns", async ({ page }) => {
	await page.setViewportSize({ width: 400, height: 800 });
	await open(page, "view=timeGridWeek&date=2026-10-21&tz=Europe%2FLondon&locale=en-GB");
	const widths = await page.locator(".tnc-dh").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
	expect(Math.min(...widths)).toBeGreaterThanOrEqual(63);
	const scroller = page.locator(".tnc-tg-scroll");
	await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
	// The time axis stays pinned while the days scroll under it.
	const gutter = await page.locator(".tnc-gutter").boundingBox();
	const box = await scroller.boundingBox();
	expect(gutter && box && Math.abs(gutter.x - box.x)).toBeLessThan(2);
});
