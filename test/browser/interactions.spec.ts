import { expect, test } from "@playwright/test";
import { center, drag, item, lastLog, open, slotPoint } from "./helpers";

test.describe("time grid", () => {
	test("dragging a task moves it and reports TaskNotes-style strings", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		const el = item(page, "scheduled-1"); // Mon 19th 09:00-10:30
		const from = await center(el);
		const target = await slotPoint(page, "2026-10-20", 14 * 60 + 5);
		const delta = { x: target.x - from.x, y: target.y - (await slotPoint(page, "2026-10-19", 9 * 60 + 5)).y };
		await drag(page, from, { x: from.x + delta.x, y: from.y + delta.y });
		await expect.poll(() => lastLog(page, "drop")).toBe("drop scheduled-1 2026-10-20T14:00 → 2026-10-20T15:30");
		await expect(page.locator('.tnc-col[data-date="2026-10-20"] .tnc-item[data-id="scheduled-1"]')).toBeVisible();
		await expect(page.locator('.tnc-col[data-date="2026-10-19"] .tnc-item[data-id="scheduled-1"]')).toHaveCount(0);
	});

	test("resizing changes only the end", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		const el = item(page, "scheduled-8"); // Thu 22nd 13:00-14:00
		await el.scrollIntoViewIfNeeded();
		const box = (await el.boundingBox())!;
		const handle = { x: box.x + box.width / 2, y: box.y + box.height - 2 };
		const to = await slotPoint(page, "2026-10-22", 15 * 60 + 30);
		await drag(page, handle, { x: handle.x, y: to.y });
		await expect.poll(() => lastLog(page, "resize")).toBe("resize scheduled-8 2026-10-22T13:00 → 2026-10-22T15:30");
	});

	test("drag-selecting empty slots creates a task", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		const a = await slotPoint(page, "2026-10-23", 18 * 60 + 10);
		const b = await slotPoint(page, "2026-10-23", 19 * 60 + 20);
		await drag(page, a, b);
		await expect.poll(() => lastLog(page, "select")).toBe("select 2026-10-23T18:00 → 2026-10-23T19:30");
		await expect(page.locator('.tnc-col[data-date="2026-10-23"] .tnc-item', { hasText: "New task" })).toBeVisible();
	});

	test("a single click selects one slot (the plugin opens its create menu from this)", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		const p = await slotPoint(page, "2026-10-23", 19 * 60 + 40);
		await page.mouse.click(p.x, p.y);
		await expect.poll(() => lastLog(page, "select")).toBe("select 2026-10-23T19:30 → 2026-10-23T20:00");
		expect(await lastLog(page, "dateclick")).toBe("dateclick 2026-10-23");
	});

	test("a timed task dropped on the all-day row becomes all-day", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		const from = await center(item(page, "scheduled-3"));
		const head = await page.locator('.tnc-dh[data-date="2026-10-21"]').boundingBox();
		const allDay = await page.locator(".tnc-allday-layer").boundingBox();
		await drag(page, from, { x: head!.x + head!.width / 2, y: allDay!.y + allDay!.height - 6 });
		await expect.poll(() => lastLog(page, "drop")).toBe("drop scheduled-3 2026-10-21 → 2026-10-22 (all-day)");
	});

	test("Escape cancels a drag and a failed write reverts", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		const el = item(page, "scheduled-2");
		const before = await el.boundingBox();
		const from = await center(el);
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x + 200, from.y + 120, { steps: 6 });
		await page.keyboard.press("Escape");
		await page.mouse.up();
		expect(await lastLog(page, "drop")).toBeUndefined();
		expect(await el.boundingBox()).toEqual(before);

		await page.evaluate(() =>
			window.tnc.setItems(window.tnc.items().map((i) => (i.id === "scheduled-2" ? { ...i, title: "FAIL review" } : i))),
		);
		const from2 = await center(item(page, "scheduled-2"));
		await drag(page, from2, { x: from2.x, y: from2.y + 140 });
		await expect.poll(() => lastLog(page, "write failed")).toBe("write failed scheduled-2");
		await expect.poll(async () => (await item(page, "scheduled-2").boundingBox())?.y).toBeCloseTo(before!.y, 0);
	});

	test("dropping a tray card schedules it", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		const card = await center(page.locator('.card[data-title="Read RFC"]'));
		const to = await slotPoint(page, "2026-10-22", 18 * 60 + 5);
		await drag(page, card, to, 14);
		await expect.poll(() => lastLog(page, "external")).toBe("external Read RFC 2026-10-22T18:00 → 2026-10-22T19:00");
		await expect(page.locator('.tnc-col[data-date="2026-10-22"] .tnc-item', { hasText: "Read RFC" })).toBeVisible();
		await expect(page.locator('.card[data-title="Read RFC"]')).toHaveCount(0);
	});

	test("Alt+Arrow nudges by the snap duration", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		await item(page, "scheduled-9").focus();
		await page.keyboard.press("Alt+ArrowDown");
		await expect.poll(() => lastLog(page, "drop")).toBe("drop scheduled-9 2026-10-23T15:30 → 2026-10-23T16:30");
	});

	test("an update re-renders only the touched day", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		await page.evaluate(() => {
			for (const el of document.querySelectorAll<HTMLElement>(".tnc-item")) (el as HTMLElement & { _mark?: boolean })._mark = true;
			window.tnc.setItems(window.tnc.items().map((i) => (i.id === "scheduled-8" ? { ...i, title: "Design review (moved)" } : i)));
		});
		const fresh = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>(".tnc-item")]
				.filter((el) => !(el as HTMLElement & { _mark?: boolean })._mark)
				.map((el) => el.dataset.id),
		);
		expect(fresh).toEqual(["scheduled-8"]);
	});
});

test.describe("other views", () => {
	test("month: dragging an all-day span shifts it by whole days", async ({ page }) => {
		await open(page, "view=dayGridMonth");
		const from = await center(item(page, "span-1")); // Mon 19 → Thu 22
		const cell = await page.locator('.tnc-dg-day[data-date="2026-10-21"]').boundingBox();
		const start = await page.locator('.tnc-dg-day[data-date="2026-10-19"]').boundingBox();
		await drag(page, from, { x: from.x + (cell!.x - start!.x), y: from.y + (cell!.y - start!.y) });
		await expect.poll(() => lastLog(page, "drop")).toBe("drop span-1 2026-10-21 → 2026-10-24 (all-day)");
	});

	test("month: '+N more' opens a popover with every item that day", async ({ page }) => {
		await open(page, "view=dayGridMonth");
		const more = page.locator('.tnc-more').filter({ hasText: /more/ }).first();
		await more.click();
		const pop = page.getByRole("dialog");
		await expect(pop).toBeVisible();
		await expect(pop.locator(".tnc-item")).not.toHaveCount(0);
		await page.keyboard.press("Escape");
		await expect(pop).toHaveCount(0);
		await expect(more).toBeFocused();
	});

	test("timeline: drag shifts a bar by days, and ports create dependencies", async ({ page }) => {
		await open(page, "view=timeline");
		const bar = item(page, "p-app-research");
		const from = await center(bar);
		const dayW = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".tnc-tl")!).getPropertyValue("--tnc-tl-day-w")));
		await drag(page, from, { x: from.x + dayW * 2, y: from.y });
		await expect.poll(() => lastLog(page, "drop")).toMatch(/^drop p-app-research 2026-10-(\d+) → 2026-10-(\d+) \(all-day\) row=p-app-research$/);
		const log = (await lastLog(page, "drop"))!;
		const [, s] = /2026-10-(\d+)/.exec(log)!;
		expect(Number(s)).toBe(24 + 2); // the second project starts at today + 3

		await bar.hover();
		const port = bar.locator(".tnc-port");
		const target = await center(item(page, "p-web-build"));
		await drag(page, await center(port), target);
		await expect.poll(() => lastLog(page, "link")).toBe("link p-app-research -> p-web-build");
	});

	test("list and year views render the range", async ({ page }) => {
		await open(page, "view=listWeek");
		await expect(page.locator(".tnc-list-section").first()).toHaveAttribute("data-date", "2026-10-21");
		await expect(page.locator(".tnc-list-section")).toHaveCount(4); // 21st-24th have items; 25th-27th are empty
		await open(page, "view=multiMonthYear");
		await expect(page.locator(".tnc-ym")).toHaveCount(12);
		await expect(page.locator('.tnc-ym-day[data-date="2026-10-21"]')).toHaveClass(/has-items/);
	});
});

test.describe("Bases settings", () => {
	test("layout settings map to the grid", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		await page.evaluate(() => window.tnc.setLayout({ showWeekends: false, firstDay: "0", slotMinTime: "08:00:00", slotMaxTime: "26:00:00", timeFormat: "12", todayColumnWidthMultiplier: 2 }));
		await expect(page.locator(".tnc-col")).toHaveCount(5);
		await expect(page.locator(".tnc-dh").first()).toHaveAttribute("data-date", "2026-10-19");
		await expect(page.locator(".tnc-slot-label").first()).toHaveText("9am");
		await expect(page.locator(".tnc-slot-label").last()).toHaveText("1am");
		const widths = await page.locator(".tnc-col").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
		expect(widths[2]! / widths[0]!).toBeCloseTo(2, 1);
		// A task past midnight shows in the extended range of the previous day.
		await expect(page.locator('.tnc-col[data-date="2026-10-21"] .tnc-item[data-id="scheduled-10"]')).toBeVisible();
	});

	test("hidden time grid leaves an all-day list of everything", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		await page.evaluate(() => window.tnc.setLayout({ showTimeGrid: false }));
		await expect(page.locator(".tnc-col")).toHaveCount(0);
		await expect(page.locator(".tnc-allday-layer .tnc-item[data-id='scheduled-1']")).toBeVisible();
		await expect(page.locator(".tnc-allday-layer .tnc-more")).toHaveCount(0);
	});
});

test("works in a popout window", async ({ page }) => {
	await open(page, "view=timeGridWeek");
	const popupPromise = page.waitForEvent("popup");
	await page.evaluate(() => {
		const w = window.open("about:blank", "pop", "width=900,height=700")!;
		const css = [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join("\n");
		w.document.head.innerHTML = `<style>${css} html,body{margin:0;height:100%}</style>`;
		const host = w.document.createElement("div");
		host.style.height = "100vh";
		w.document.body.append(host);
		const Cal = window.tnc.calendar.constructor as typeof window.tnc.calendar.constructor & (new (...a: unknown[]) => unknown);
		const log: string[] = [];
		(w as unknown as { log: string[] }).log = log;
		new Cal(host, {
			view: "day",
			date: "2026-10-21",
			slotMinTime: "08:00",
			slotMaxTime: "12:00",
			toolbar: false,
			onItemDrop: (a: { startStr: string }) => void log.push(a.startStr),
		}, [{ id: "a", title: "Popout task", start: "2026-10-21T09:00", end: "2026-10-21T10:00" }]);
	});
	const popup = await popupPromise;
	const el = popup.locator('.tnc-item[data-id="a"]');
	await expect(el).toBeVisible();
	const box = (await el.boundingBox())!;
	await popup.mouse.move(box.x + 20, box.y + 10);
	await popup.mouse.down();
	await popup.mouse.move(box.x + 22, box.y + 20, { steps: 2 });
	await popup.mouse.move(box.x + 20, box.y + 10 + box.height, { steps: 6 });
	await popup.mouse.up();
	await expect.poll(() => popup.evaluate(() => (window as unknown as { log: string[] }).log[0])).toBe("2026-10-21T10:00");
});

test("@touch long-press drags, a quick swipe scrolls", async ({ page }) => {
	await open(page, "view=timeGridDay&date=2026-10-22");
	const el = item(page, "scheduled-8");
	await el.scrollIntoViewIfNeeded();
	const box = (await el.boundingBox())!;
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
		cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
	const x = box.x + 20;
	const y = box.y + 10;
	const scroller = page.locator(".tnc-tg-scroll");
	const scrollBefore = await scroller.evaluate((e) => e.scrollTop);

	// Quick swipe: scrolls, no drag.
	await touch("touchStart", x, y);
	for (let i = 1; i <= 6; i++) await touch("touchMove", x, y - i * 20);
	await touch("touchEnd", x, y - 120);
	await expect.poll(() => scroller.evaluate((e) => e.scrollTop)).toBeGreaterThan(scrollBefore);
	expect(await lastLog(page, "drop")).toBeUndefined();

	// Long press, then move: drags.
	const b2 = (await el.boundingBox())!;
	await touch("touchStart", b2.x + 20, b2.y + 10);
	await page.waitForTimeout(450);
	for (let i = 1; i <= 6; i++) await touch("touchMove", b2.x + 20, b2.y + 10 + i * 16);
	await touch("touchEnd", b2.x + 20, b2.y + 106);
	await expect.poll(() => lastLog(page, "drop")).toMatch(/^drop scheduled-8 2026-10-22T1[45]:00/);
});
