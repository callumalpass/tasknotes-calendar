import { expect, test } from "@playwright/test";
import { center, item, open, slotPoint } from "./helpers";

test("week headers contain weekdays and two-digit today badges in narrow columns", async ({ page }) => {
	for (const width of [400, 700, 1400]) {
		await page.setViewportSize({ width, height: 900 });
		await open(page, "view=timeGridWeek&date=2026-10-21&locale=en-GB");
		await page.evaluate(() => {
			document.querySelector<HTMLElement>("#side")!.style.display = "none";
			document.querySelector<HTMLElement>(".tnc")!.style.setProperty("--tnc-col-min", "0px");
			window.tnc.calendar.updateSize();
		});
		await expect(page.locator(".tnc-dh")).toHaveCount(7);
		const contained = await page.locator(".tnc-dh").evaluateAll(headers => headers.every(header => {
			const bounds = header.getBoundingClientRect();
			return Array.from(header.querySelectorAll(".tnc-dh-dow, .tnc-dh-num")).every(label => {
				const rect = label.getBoundingClientRect();
				return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
			});
		}));
		expect(contained).toBe(true);
		if (width === 400) await expect(page.locator(".tnc-tg-head")).toHaveScreenshot("narrow-week-headers.png");
	}
});

for (const view of ["timeGridDay", "dayGridMonth", "timeline"]) {
	test(`${view}: move retains an inert dim source and clears it after Escape, drop and rejected drop`, async ({ page }) => {
		await open(page, `view=${view}&date=2026-10-21&tz=UTC`);
		await page.evaluate(view => {
			if (view === "timeline") window.tnc.calendar.setOptions({
				timeline: { rows: [{ id: "row", title: "Tasks" }], rowOf: () => "row" },
				onItemDrop: () => undefined,
			});
			const items = [{ id: "anchor", title: "Review release notes", start: "2026-10-21T13:00", end: "2026-10-21T14:00" }];
			if (view === "timeline") window.tnc.calendar.setItems(items);
			else window.tnc.setItems(items);
		}, view);
		const anchor = item(page, "anchor");
		const start = await center(anchor);
		const before = (await anchor.boundingBox())!;
		const target = view === "timeGridDay" ? await slotPoint(page, "2026-10-21", 15 * 60 + 10) : { x: start.x + 100, y: start.y };
		const begin = async () => {
			await page.mouse.move(start.x, start.y);
			await page.mouse.down();
			await page.mouse.move(target.x, target.y, { steps: 16 });
		};
		await begin();
		const source = page.locator(".tnc-drag-source");
		await expect(source).toHaveCount(1);
		await expect(source).toBeVisible();
		await expect(source).toHaveAttribute("aria-hidden", "true");
		await expect(source).toHaveAttribute("inert", "");
		expect(await source.evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThan(0.6);
		expect(Math.abs((await source.boundingBox())!.y - before.y)).toBeLessThan(1);
		expect(Math.abs((await source.boundingBox())!.x - before.x)).toBeLessThan(1);
		await expect(page.locator('[data-id="anchor"]')).toHaveCount(1);
		await page.keyboard.press("Escape");
		await page.mouse.up();
		await expect(source).toHaveCount(0);
		expect(await page.evaluate(() => window.tnc.calendar.getItem("anchor")?.start)).toBe("2026-10-21T13:00");
		await begin();
		await page.mouse.up();
		await expect(source).toHaveCount(0);
		await expect(anchor).not.toHaveClass(/is-dragging/);
		await expect(anchor).not.toHaveAttribute("aria-busy");
		const persisted = await page.evaluate(() => window.tnc.calendar.getItem("anchor"));
		await page.evaluate(() => window.tnc.calendar.setOptions({ canDrop: () => false }));
		const next = await center(anchor);
		await page.mouse.move(next.x, next.y);
		await page.mouse.down();
		await page.mouse.move(next.x + 120, next.y + 50, { steps: 16 });
		await page.mouse.up();
		await expect(source).toHaveCount(0);
		expect(await page.evaluate(() => window.tnc.calendar.getItem("anchor"))).toEqual(persisted);
	});
}
