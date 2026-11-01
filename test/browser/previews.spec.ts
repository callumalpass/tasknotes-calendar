import { expect, test } from "@playwright/test";
import { center, item, open, slotPoint } from "./helpers";

for (const view of ["dayGridMonth", "timeGridWeek"]) {
	test(`${view}: multiple all-day previews stay visible beyond event limits without overlapping`, async ({ page }) => {
		await open(page, `view=${view}&date=2026-10-21&tz=UTC`);
		await page.evaluate(() => {
			const calendar = window.tnc.calendar;
			calendar.setOptions({ dayMaxEvents: 1, dayMaxEventRows: 1, itemDidMount: arg => {
				if (arg.item.preview) window.tnc.log.push(`preview ${arg.item.id} mirror=${arg.isMirror}`);
			} });
			calendar.setItems([
				...Array.from({ length: 5 }, (_, i) => ({ id: `busy-${i}`, title: `Busy ${i}`, start: "2026-10-21", allDay: true })),
				{ id: "peer-1", title: "Preview 1", start: "2026-10-21", allDay: true, preview: true },
				{ id: "peer-2", title: "Preview 2", start: "2026-10-21", allDay: true, preview: true },
			]);
		});
		const first = item(page, "peer-1"), second = item(page, "peer-2");
		await expect(first).toBeVisible(); await expect(second).toBeVisible();
		const a = (await first.boundingBox())!, b = (await second.boundingBox())!;
		expect(a.y + a.height).toBeLessThanOrEqual(b.y);
		await expect(first).toHaveClass(/is-mirror/);
		await expect(first).toHaveAttribute("aria-hidden", "true");
		expect(await first.getAttribute("tabindex")).toBeNull();
		expect(await first.evaluate(el => getComputedStyle(el).pointerEvents)).toBe("none");
		await expect(first.locator(".tnc-resize")).toHaveCount(0);
		expect(await page.evaluate(() => window.tnc.log)).toContain("preview peer-1 mirror=true");
		await first.dispatchEvent("click");
		expect(await page.evaluate(() => window.tnc.log.filter(line => line.startsWith("click ")))).toEqual([]);
		await page.evaluate(() => window.tnc.calendar.setOptions({ selected: ["peer-1", "peer-2"] }));
		await expect(first).not.toHaveClass(/is-selected/);
		await page.evaluate(() => window.tnc.calendar.upsertItems([
			{ id: "peer-1", title: "Restored", start: "2026-10-22", allDay: true },
		]));
		await expect(first).toHaveAttribute("role", "button");
		await expect(first).not.toHaveAttribute("aria-hidden", "true");
		await expect(first).not.toHaveClass(/is-mirror/);
	});
}

test("timed previews remain visible with positive widths when eventMaxStack hides their cluster", async ({ page }) => {
	await open(page, "view=timeGridWeek&date=2026-10-21&tz=UTC");
	await page.evaluate(() => {
		const calendar = window.tnc.calendar;
		calendar.setOptions({ eventMaxStack: 1, slotEventOverlap: false });
		calendar.setItems([
			...Array.from({ length: 5 }, (_, i) => ({ id: `busy-${i}`, title: `Busy ${i}`, start: "2026-10-21T09:00", end: "2026-10-21T10:00" })),
			{ id: "peer-1", title: "Preview 1", start: "2026-10-21T09:00", end: "2026-10-21T10:00", preview: true },
			{ id: "peer-2", title: "Preview 2", start: "2026-10-21T09:00", end: "2026-10-21T10:00", preview: true },
		]);
	});
	await expect(item(page, "peer-1")).toBeVisible(); await expect(item(page, "peer-2")).toBeVisible();
	const a = (await item(page, "peer-1").boundingBox())!, b = (await item(page, "peer-2").boundingBox())!;
	expect(a.width).toBeGreaterThan(0); expect(b.width).toBeGreaterThan(0);
	expect(a.x).not.toBe(b.x);
	await expect(item(page, "peer-1")).toHaveAttribute("aria-hidden", "true");
});

test("the dragged anchor stays visible when entering a limited timed cluster", async ({ page }) => {
	await open(page, "view=timeGridWeek&date=2026-10-21&tz=UTC");
	await page.evaluate(() => {
		const calendar = window.tnc.calendar;
		calendar.setOptions({ eventMaxStack: 1, slotEventOverlap: false });
		calendar.setItems([
			{ id: "anchor", title: "Anchor", start: "2026-10-20T09:00", end: "2026-10-20T10:00" },
			...Array.from({ length: 5 }, (_, i) => ({ id: `busy-${i}`, title: `Busy ${i}`, start: "2026-10-21T09:00", end: "2026-10-21T10:00" })),
		]);
	});
	const from = await center(item(page, "anchor")), to = await slotPoint(page, "2026-10-21", 9 * 60 + 10);
	await page.mouse.move(from.x, from.y); await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 20 });
	await expect(item(page, "anchor")).toBeVisible();
	await expect(item(page, "anchor")).toHaveClass(/is-dragging/);
	expect((await item(page, "anchor").boundingBox())!.width).toBeGreaterThan(0);
	await page.keyboard.press("Escape"); await page.mouse.up();
});
