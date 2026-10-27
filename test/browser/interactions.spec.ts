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
		// The click names the slot's time, so quick capture can prefill it.
		expect(await lastLog(page, "dateclick")).toBe("dateclick 2026-10-23T19:30");
		const head = await page.locator(".tnc-allday-layer").boundingBox();
		const col = await page.locator('.tnc-col[data-date="2026-10-23"]').boundingBox();
		await page.mouse.click(col!.x + col!.width / 2, head!.y + head!.height - 3);
		await expect.poll(() => lastLog(page, "dateclick")).toBe("dateclick 2026-10-23");
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

	test("month: a dragged item moves with the pointer before it is dropped", async ({ page }) => {
		await open(page, "view=dayGridMonth");
		const el = item(page, "span-1"); // Mon 19 – Wed 21
		const from = await center(el);
		const start = (await el.boundingBox())!;
		const target = (await page.locator('.tnc-dg-day[data-date="2026-10-21"]').boundingBox())!;
		const source = (await page.locator('.tnc-dg-day[data-date="2026-10-19"]').boundingBox())!;
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x + 2, from.y + 6, { steps: 2 });
		await page.mouse.move(from.x + (target.x - source.x), from.y, { steps: 8 });
		// Mid-drag: drawn in the target cell, still marked as dragging, nothing saved yet.
		const mid = (await el.boundingBox())!;
		expect(mid.x - start.x).toBeCloseTo(target.x - source.x, -1);
		await expect(el).toHaveClass(/is-dragging/);
		expect(await lastLog(page, "drop")).toBeUndefined();
		await page.mouse.move(from.x + (target.x - source.x) - (target.x - source.x) / 2, from.y, { steps: 4 });
		expect((await el.boundingBox())!.x - start.x).toBeCloseTo((target.x - source.x) / 2, -1);
		await page.mouse.up();
		await expect.poll(() => lastLog(page, "drop")).toBe("drop span-1 2026-10-20 → 2026-10-23 (all-day)");
	});

	test("month: rows make room for a tall '+N more' link", async ({ page }) => {
		await open(page, "view=dayGridMonth");
		await page.addStyleTag({ content: ".tnc { --tnc-more-h: 44px; }" });
		await page.evaluate(() => window.tnc.calendar.rerender());
		const more = page.locator(".tnc-more").first();
		await expect(more).toBeVisible();
		const overflow = await page.locator(".tnc-dg-week").evaluateAll((rows) =>
			rows.flatMap((row) => {
				const r = row.getBoundingClientRect();
				return [...row.querySelectorAll(".tnc-more, .tnc-item")].map((el) => el.getBoundingClientRect().bottom - r.bottom).filter((d) => d > 0.5);
			}),
		);
		expect(overflow).toEqual([]);
		expect((await more.boundingBox())!.height).toBe(44);
	});

	test("month dots: cells wrap one dot per item with a count, and the cell takes the tap", async ({ page }) => {
		await open(page, "view=dayGridMonth&display=dots");
		const cell = page.locator('.tnc-dg-day[data-date="2026-10-19"]');
		const dots = cell.locator(".tnc-item--indicator");
		await expect(dots.first()).toBeVisible();
		const n = await dots.count();
		const more = (await cell.locator(".tnc-dg-dots-more").allTextContents())[0];
		const total = n + (more ? Number(more.slice(1)) : 0);
		await expect(cell).toHaveAttribute("aria-label", `Monday, 19 October 2026, ${total} items`);
		// Dots wrap across the cell instead of stacking as rows.
		const ys = new Set(await dots.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y))));
		expect(ys.size).toBeLessThan(n);
		await expect(dots.first()).toHaveAttribute("aria-hidden", "true");
		await expect(page.locator(".tnc-dg .tnc-item.is-draggable")).toHaveCount(0);
		const dot = (await dots.first().boundingBox())!;
		await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2);
		await expect.poll(() => lastLog(page, "dateclick")).toBe("dateclick 2026-10-19");
		expect(await lastLog(page, "click ")).toBeUndefined();
		// A cap leaves a count for the rest.
		await page.evaluate(() => window.tnc.setLayout({ dayMaxEvents: 3 }));
		await expect(dots).toHaveCount(3);
		await expect(cell.locator(".tnc-dg-dots-more")).toHaveText(`+${total - 3}`);
	});

	test("render hooks get the variant and a formatted time", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		const seen = await page.evaluate(() => {
			const host = document.createElement("div");
			host.style.cssText = "position:fixed;inset:0;height:600px;background:#fff";
			document.body.append(host);
			const Cal = window.tnc.calendar.constructor as new (...a: unknown[]) => { setOptions(o: unknown): void; flush(): void };
			const out: string[] = [];
			const cal = new Cal(host, {
				view: "week",
				date: "2026-10-21",
				hour12: true,
				itemDidMount: (a: { item: { id: string }; variant: string; timeText: string }) => out.push(`${a.item.id} ${a.variant} ${a.timeText}`),
			}, [
				{ id: "t", title: "Timed", start: "2026-10-21T09:00", end: "2026-10-21T10:30" },
				{ id: "a", title: "All day", start: "2026-10-21" },
			]);
			cal.setOptions({ view: "month" });
			cal.setOptions({ view: "list" });
			return out;
		});
		expect(seen).toEqual(expect.arrayContaining(["t timed 9am – 10:30am", "a bar ", "t dot 9am", "t list 9am – 10:30am", "a list "]));
	});

	test("callbacks see the latest item passed to setItems, even when it draws the same", async ({ page }) => {
		await open(page, "view=timeGridWeek");
		const result = await page.evaluate(() => {
			const host = document.createElement("div");
			host.style.cssText = "position:fixed;inset:0;height:600px;background:#fff";
			document.body.append(host);
			type Item = { id: string; title: string; start: string; data: { load: () => string } };
			const Cal = window.tnc.calendar.constructor as new (...a: unknown[]) => { setItems(i: Item[]): void; flush(): void };
			const clicked: string[] = [];
			const mounted: string[] = [];
			const item = (version: string): Item => ({ id: "x", title: "Same", start: "2026-10-21T09:00", data: { load: () => version } });
			const cal = new Cal(host, {
				view: "week",
				date: "2026-10-21",
				onItemClick: (a: { item: Item }) => clicked.push(a.item.data.load()),
				itemDidMount: () => mounted.push("mount"),
			}, [item("v1")]);
			cal.setItems([item("v2")]);
			cal.flush();
			host.querySelector<HTMLElement>('.tnc-item[data-id="x"]')!.click();
			host.remove();
			return { clicked, mounted };
		});
		// Functions do not serialise, so v2 draws the same: no remount, but the click sees v2.
		expect(result).toEqual({ clicked: ["v2"], mounted: ["mount"] });
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

	test("timeline: drag shifts a bar by days", async ({ page }) => {
		await open(page, "view=timeline");
		const bar = item(page, "p-app-research");
		const from = await center(bar);
		const dayW = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".tnc-tl")!).getPropertyValue("--tnc-tl-day-w")));
		await drag(page, from, { x: from.x + dayW * 2, y: from.y });
		await expect.poll(() => lastLog(page, "drop")).toMatch(/^drop p-app-research 2026-10-(\d+) → 2026-10-(\d+) \(all-day\) row=p-app-research$/);
		const log = (await lastLog(page, "drop"))!;
		const [, s] = /2026-10-(\d+)/.exec(log)!;
		expect(Number(s)).toBe(24 + 2); // the second project starts at today + 3
	});

	test("list and year views render the range", async ({ page }) => {
		await open(page, "view=listWeek");
		await expect(page.locator(".tnc-list-section").first()).toHaveAttribute("data-date", "2026-10-21");
		await expect(page.locator(".tnc-list-section")).toHaveCount(4); // 21st-24th have items; 25th-27th are empty
		await open(page, "view=listWeek&listStart=week");
		await expect(page.locator(".tnc-list-section").first()).toHaveAttribute("data-date", "2026-10-19");
		await page.locator(".tnc-btn-next").click();
		await expect(page.locator(".tnc-title")).toHaveText("26 Oct – 1 Nov 2026");
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

test("@touch month: a long-press drag previews the item in the target cell", async ({ page }) => {
	await open(page, "view=dayGridMonth");
	const el = item(page, "span-1"); // Mon 19 – Wed 21
	const box = (await el.boundingBox())!;
	const source = (await page.locator('.tnc-dg-day[data-date="2026-10-19"]').boundingBox())!;
	const target = (await page.locator('.tnc-dg-day[data-date="2026-10-20"]').boundingBox())!;
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
		cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
	const x = box.x + 6;
	const y = box.y + box.height / 2;
	const dx = target.x - source.x;
	await touch("touchStart", x, y);
	await page.waitForTimeout(450);
	for (let i = 1; i <= 6; i++) await touch("touchMove", x + (dx * i) / 6, y);
	const mid = (await el.boundingBox())!;
	expect(mid.x - box.x).toBeCloseTo(dx, -1);
	expect(await lastLog(page, "drop")).toBeUndefined();
	await touch("touchEnd", x + dx, y);
	await expect.poll(() => lastLog(page, "drop")).toBe("drop span-1 2026-10-20 → 2026-10-23 (all-day)");
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

test("a calendar moved into another window keeps dragging (popout windows)", async ({ page }) => {
	await open(page, "view=timeGridWeek");
	// Hosts like Obsidian move the live DOM into a popout; a same-origin iframe is another window.
	await page.evaluate(async () => {
		const frame = document.createElement("iframe");
		frame.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;border:0;background:white";
		document.body.append(frame);
		await new Promise((r) => setTimeout(r, 0));
		const doc = frame.contentDocument!;
		for (const sheet of document.querySelectorAll("link[rel=stylesheet], style")) doc.head.append(sheet.cloneNode(true));
		doc.body.style.cssText = "margin:0;height:100vh;display:flex";
		await new Promise((r) => setTimeout(r, 50));
		doc.body.append(window.tnc.calendar.host);
	});
	const frame = page.frameLocator("iframe");
	const el = frame.locator('.tnc-item[data-id="scheduled-1"]');
	await expect(el).toBeVisible();
	const box = (await el.boundingBox())!;
	const target = (await frame.locator('.tnc-col[data-date="2026-10-20"]').boundingBox())!;
	const from = { x: box.x + box.width / 2, y: box.y + 8 };
	await drag(page, from, { x: target.x + target.width / 2, y: from.y });
	await expect.poll(() => lastLog(page, "drop")).toMatch(/^drop scheduled-1 2026-10-20T/);
});

test.describe("agenda list", () => {
	test("the strip picks a day, follows the list, and more days load near the end", async ({ page }) => {
		await open(page, "view=listWeek&agenda=1");
		await expect(page.locator(".tnc-strip-day.is-focus")).toHaveAttribute("data-date", "2026-10-21");
		await page.locator(".tnc-strip-title").click();
		await page.locator('.tnc-strip-day[data-date="2026-10-29"]').click();
		await expect(page.locator(".tnc-strip")).not.toHaveClass(/is-expanded/);
		expect(await lastLog(page, "dateclick")).toBe("dateclick 2026-10-29");
		const strip = (await page.locator(".tnc-strip").boundingBox())!;
		const picked = (await page.locator('.tnc-list-section[data-date="2026-10-29"]').boundingBox())!;
		expect(Math.abs(picked.y - (strip.y + strip.height))).toBeLessThan(4);
		const before = await page.evaluate(() => window.tnc.calendar.getView().range.endDay);
		await page.mouse.move(700, 600);
		for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 2500);
		await expect.poll(() => page.evaluate(() => window.tnc.calendar.getView().range.endDay)).toBeGreaterThan(before);
		await expect(page.locator(".tnc-strip-day.is-focus")).not.toHaveAttribute("data-date", "2026-10-29");
	});

	test("dragging a row onto a strip day moves it there at the same time", async ({ page }) => {
		await open(page, "view=listWeek&agenda=1");
		const from = await center(item(page, "due-1")); // Wed 21st 17:00
		const day = await center(page.locator('.tnc-strip-day[data-date="2026-10-24"]'));
		await drag(page, from, day);
		await expect.poll(() => lastLog(page, "drop")).toBe("drop due-1 2026-10-24T17:00 → 2026-10-24T17:30");
		await expect(page.locator(".tnc-strip-day.is-drop-target")).toHaveCount(0);
	});
});

test("@touch agenda rows scroll the page at auto height", async ({ page }) => {
	await open(page, "view=listWeek&agenda=1&height=auto");
	await page.addStyleTag({ content: "#side{display:none} #app{height:auto}" });
	const el = item(page, "due-1");
	await el.scrollIntoViewIfNeeded();
	const box = (await el.boundingBox())!;
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
		cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
	const before = await page.evaluate(() => document.scrollingElement!.scrollTop);
	await touch("touchStart", box.x + 40, box.y + 10);
	for (let i = 1; i <= 6; i++) await touch("touchMove", box.x + 40, box.y + 10 - i * 25);
	await touch("touchEnd", box.x + 40, box.y - 140);
	await expect.poll(() => page.evaluate(() => document.scrollingElement!.scrollTop)).toBeGreaterThan(before + 60);
	expect(await lastLog(page, "drop")).toBeUndefined();
});
