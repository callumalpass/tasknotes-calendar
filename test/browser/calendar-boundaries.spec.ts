import { expect, test } from "@playwright/test";
import { center, item, open, slotPoint } from "./helpers";

for (const view of ["timeGridDay", "timeGridWeek", "timeGridCustom", "dayGridMonth"]) {
	for (const kind of ["scheduled", "timeblock", "timeEntry"]) {
		test(`${view} ${kind}: leaving a date target invalidates the proposal and release`, async ({ page }) => {
			await open(page, `view=${view}&date=2026-10-21&tz=UTC`);
			await page.evaluate(kind => {
				window.tnc.calendar.setItems([{ id: "boundary", title: "Boundary task", start: "2026-10-21T10:00", end: "2026-10-21T11:00", kind }]);
			}, kind);
			const before = await page.evaluate(() => window.tnc.calendar.getItem("boundary"));
			const origin = await center(item(page, "boundary"));
			await page.mouse.move(origin.x, origin.y); await page.mouse.down();
			await page.mouse.move(origin.x, origin.y + 35, { steps: 8 });
			await page.mouse.move(2, 2, { steps: 12 });
			await expect(page.locator(".tnc")).toHaveClass(/tnc-drop-denied/);
			await page.mouse.up();
			expect(await page.evaluate(() => window.tnc.calendar.getItem("boundary"))).toEqual(before);
			expect(await page.evaluate(() => window.tnc.log.filter(line => /^(drop|resize) /.test(line)))).toEqual([]);
		});
	}
}

for (const view of ["timeGridDay", "timeGridWeek", "timeGridCustom", "dayGridMonth", "multiMonthYear", "listWeek"]) {
	test(`${view}: external pointer drags clear valid previews outside the calendar`, async ({ page }) => {
		await open(page, `view=${view}&date=2026-10-21&tz=UTC`);
		const selector = view === "multiMonthYear" ? '.tnc-ym-day[data-date="2026-10-21"]'
			: view === "dayGridMonth" ? '.tnc-dg-day[data-date="2026-10-21"]'
				: view === "listWeek" ? '.tnc-list-section[data-date="2026-10-21"]' : '.tnc-col[data-date="2026-10-21"]';
		const valid = view.startsWith("timeGrid") ? await slotPoint(page, "2026-10-21", 12 * 60) : await center(page.locator(selector));
		await page.mouse.move(valid.x, valid.y);
		await page.evaluate(point => window.tnc.calendar.beginExternalDrag(new PointerEvent("pointerdown", { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true }), { title: "External" }), valid);
		await page.mouse.move(valid.x + 2, valid.y + 2);
		await expect(page.locator(".tnc")).not.toHaveClass(/tnc-drop-denied/);
		await page.mouse.move(2, 2, { steps: 8 });
		await expect(page.locator(".tnc")).toHaveClass(/tnc-drop-denied/);
		await expect(page.locator(".tnc-sel")).toHaveCount(0);
		await page.mouse.up();
		expect(await page.evaluate(() => window.tnc.log.filter(line => line.startsWith("externaldrop ")))).toEqual([]);
	});
}

for (const view of ["timeGridDay", "timeGridWeek", "timeGridCustom"]) {
	test(`${view}: leaving after crossing to all-day cannot save that proposal`, async ({ page }) => {
		await open(page, `view=${view}&date=2026-10-21&tz=UTC`);
		await page.evaluate(() => window.tnc.calendar.setItems([{ id: "crossing", title: "Crossing", start: "2026-10-21T10:00", end: "2026-10-21T11:00" }]));
		const before = await page.evaluate(() => window.tnc.calendar.getItem("crossing"));
		const origin = await center(item(page, "crossing"));
		const heading = (await page.locator('.tnc-dh[data-date="2026-10-21"]').boundingBox())!;
		const lane = (await page.locator('.tnc-allday-layer').boundingBox())!;
		const allDay = { x: heading.x + heading.width / 2, y: lane.y + lane.height - 6 };
		await page.mouse.move(origin.x, origin.y); await page.mouse.down();
		await page.mouse.move(allDay.x, allDay.y, { steps: 10 });
		expect(await page.evaluate(() => window.tnc.calendar.getItem("crossing")?.allDay)).toBe(true);
		await page.mouse.move(2, 2, { steps: 10 });
		await expect(page.locator(".tnc")).toHaveClass(/tnc-drop-denied/);
		await page.mouse.up();
		expect(await page.evaluate(() => window.tnc.calendar.getItem("crossing"))).toEqual(before);
		expect(await page.evaluate(() => window.tnc.log.filter(line => line.startsWith("drop ")))).toEqual([]);
	});
}

for (const mode of ["move", "resize-start", "resize-end", "external", "select"]) {
	test(`day ${mode}: validates pointerup even without a final pointermove`, async ({ page }) => {
		await open(page, "view=timeGridDay&date=2026-10-21&tz=UTC");
		await page.evaluate(() => {
			window.tnc.calendar.setOptions({ resizableFromStart: true });
			window.tnc.calendar.setItems([{ id: "boundary", title: "Boundary task", start: "2026-10-21T10:00", end: "2026-10-21T11:00" }]);
		});
		const before = await page.evaluate(() => window.tnc.calendar.getItem("boundary"));
		const target = mode.startsWith("resize") ? item(page, "boundary").locator(`.tnc-${mode}`) : item(page, "boundary");
		await target.hover();
		const start = mode === "select" ? await slotPoint(page, "2026-10-21", 13 * 60) : await center(target);
		if (mode === "external") {
			await page.evaluate(point => window.tnc.calendar.beginExternalDrag(new PointerEvent("pointerdown", { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true }), { title: "External" }), start);
		} else { await page.mouse.move(start.x, start.y); await page.mouse.down(); }
		await page.mouse.move(start.x, start.y + 38, { steps: 10 });
		await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerup", { clientX: 2, clientY: 2, pointerId: 1, bubbles: true })));
		await page.mouse.up();
		expect(await page.evaluate(() => window.tnc.calendar.getItem("boundary"))).toEqual(before);
		expect(await page.evaluate(() => window.tnc.log.filter(line => /^(drop|resize|externaldrop|select) /.test(line)))).toEqual([]);
		await expect(page.locator(".tnc-sel")).toHaveCount(0);
	});
}

test("denied targets clear stale proposals and valid targets recover", async ({ page }) => {
	await open(page, "view=timeGridDay&date=2026-10-21&tz=UTC");
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ canDrop: proposal => proposal.start.getUTCHours() < 12 });
		window.tnc.calendar.setItems([{ id: "boundary", title: "Boundary task", start: "2026-10-21T10:00", end: "2026-10-21T11:00" }]);
	});
	const from = await center(item(page, "boundary"));
	await page.mouse.move(from.x, from.y); await page.mouse.down();
	const denied = await slotPoint(page, "2026-10-21", 13 * 60 + 30);
	await page.mouse.move(denied.x, denied.y, { steps: 12 });
	await expect(page.locator(".tnc")).toHaveClass(/tnc-drop-denied/);
	const allowed = await slotPoint(page, "2026-10-21", 11 * 60 + 30);
	await page.mouse.move(allowed.x, allowed.y, { steps: 12 });
	await expect(page.locator(".tnc")).not.toHaveClass(/tnc-drop-denied/);
	await page.mouse.up();
	expect(await page.evaluate(() => window.tnc.log.filter(line => line.startsWith("drop ")).length)).toBe(1);
});

test("collision summaries occupy the complete interval", async ({ page }) => {
	await page.setViewportSize({ width: 400, height: 800 });
	await open(page, "view=timeGridWeek&date=2026-10-21&tz=UTC");
	await page.evaluate(() => window.tnc.calendar.setItems(Array.from({ length: 8 }, (_, index) => ({ id: `collision-${index}`, title: `Appointment ${index}`, start: "2026-10-21T09:00", end: "2026-10-21T11:30" }))));
	const summary = page.locator(".tnc-more--collision").first();
	await summary.scrollIntoViewIfNeeded();
	const start = await slotPoint(page, "2026-10-21", 9 * 60);
	const end = await slotPoint(page, "2026-10-21", 11 * 60 + 30);
	const bounds = (await summary.boundingBox())!;
	expect(bounds.height).toBeCloseTo(end.y - start.y, 0);
	await expect(summary).toHaveAccessibleName(/09:00.*11:30/);
	const count = await summary.locator(".tnc-collision-count").evaluate(element => ({ height: element.clientHeight, line: parseFloat(getComputedStyle(element).lineHeight), overflow: element.scrollWidth > element.clientWidth }));
	expect(count.overflow).toBe(false);
	expect(count.height).toBeLessThanOrEqual(count.line + 1);
});

for (const view of ["timeGridDay", "timeGridWeek", "timeGridCustom", "dayGridMonth", "multiMonthYear", "listWeek"]) {
	test(`${view}: native external drops validate their release point`, async ({ page }) => {
		await open(page, `view=${view}&date=2026-10-21&tz=UTC`);
		const count = await page.evaluate(() => {
			let dropped = 0;
			window.tnc.calendar.setOptions({ acceptNativeDrop: () => true, onExternalDrop: () => { dropped++; } });
			const root = document.querySelector(".tnc")!;
			const transfer = new DataTransfer(); transfer.setData("text/plain", "External task");
			root.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: 2, clientY: 2, dataTransfer: transfer }));
			root.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: 2, clientY: 2, dataTransfer: transfer }));
			return dropped;
		});
		expect(count).toBe(0);
		await expect(page.locator(".tnc-sel")).toHaveCount(0);
	});
}

test("year targets fit their months at narrow and wide sizes", async ({ page }) => {
	await open(page, "view=multiMonthYear&date=2026-10-21&tz=UTC");
	for (const width of [320, 400, 1180]) {
		await page.locator(".tnc").evaluate((element, width) => { (element as HTMLElement).style.width = `${width}px`; }, width);
		const layout = await page.locator(".tnc-year").evaluate(element => ({
			overflow: element.scrollWidth > element.clientWidth,
			months: Array.from(element.querySelectorAll(".tnc-ym")).map(month => ({
				overlap: Array.from(month.querySelectorAll(".tnc-ym-day")).some(day => day.getBoundingClientRect().right > month.getBoundingClientRect().right + 1),
				minimum: Math.min(...Array.from(month.querySelectorAll(".tnc-ym-day")).map(day => day.getBoundingClientRect().width)),
			})),
		}));
		expect(layout.overflow).toBe(false);
		for (const month of layout.months) { expect(month.overlap).toBe(false); expect(month.minimum).toBeGreaterThanOrEqual(40); }
	}
});

test("a single empty selected day retains its date heading", async ({ page }) => {
	await open(page, "view=listWeek&date=2026-10-21&tz=UTC");
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ listAgenda: false, listDayCount: 1 });
		window.tnc.calendar.setItems([]);
	});
	await expect(page.locator(".tnc-list-day")).toContainText("21 October 2026");
	await expect(page.locator(".tnc-list-section .tnc-list-empty")).toBeVisible();
	await page.evaluate(() => window.tnc.calendar.setItems([{ id: "new-task", title: "New task", start: "2026-10-21T10:00" }]));
	await expect(page.locator(".tnc-list-empty")).toHaveCount(0);
	await expect(item(page, "new-task")).toBeVisible();
});
