import { expect, test } from "@playwright/test";
import { open, center } from "./helpers";

test("empty agenda preserves host recovery alongside per-day creation", async ({ page }) => {
	await open(page, "view=listWeek&agenda=1&date=2026-10-21");
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ listAgenda: true, listEmptyContent: () => {
			const recovery = document.createElement("button");
			recovery.textContent = "Clear filters";
			return recovery;
		} });
		window.tnc.setItems([]);
	});
	await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
	await expect(page.locator(".tnc-list-add").first()).toBeVisible();
	await page.evaluate(() => window.tnc.setItems([{ id: "single", title: "Single task", start: "2026-10-21" }]));
	await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);
});

test("drag origin stays in place and Escape restores the event exactly", async ({ page }) => {
	await open(page, "view=timeGridDay&date=2026-10-21");
	await page.evaluate(() => window.tnc.setItems([{ id: "gesture", title: "Write release notes", start: "2026-10-21T10:00", end: "2026-10-21T11:00" }]));
	const event = page.locator('.tnc-item[data-id="gesture"]');
	const before = await event.boundingBox();
	const pointer = await center(event);
	await page.mouse.move(pointer.x, pointer.y);
	await page.mouse.down();
	await page.mouse.move(pointer.x, pointer.y + 60, { steps: 10 });
	const origin = page.locator(".tnc-drag-origin");
	await expect(origin).toHaveCount(1);
	expect(await origin.boundingBox()).toEqual(before);
	await expect(origin).toHaveAttribute("aria-hidden", "true");
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect(origin).toHaveCount(0);
	await expect(page.locator(".tnc-dragging")).toHaveCount(0);
	expect(await event.boundingBox()).toEqual(before);
});

test("agenda drag preview follows the pointer without changing row geometry", async ({ page }) => {
	await open(page, "view=listWeek&agenda=1&date=2026-10-21");
	await page.evaluate(() => window.tnc.setItems([
		{ id: "list-origin", title: "Agenda source", start: "2026-10-21T10:00", end: "2026-10-21T11:00" },
		{ id: "list-peer", title: "Stable neighbour", start: "2026-10-21T11:00", end: "2026-10-21T12:00" },
	]));
	const origin = page.locator('.tnc-item[data-id="list-origin"]');
	const peer = page.locator('.tnc-item[data-id="list-peer"]');
	const before = await origin.boundingBox();
	const peerBefore = await peer.boundingBox();
	const pointer = await center(origin);
	await page.mouse.move(pointer.x, pointer.y);
	await page.mouse.down();
	await page.mouse.move(pointer.x + 30, pointer.y + 40, { steps: 8 });
	const preview = page.locator(".tnc-drag-preview");
	await expect(preview).toBeVisible();
	await expect(preview).toHaveAttribute("aria-hidden", "true");
	expect(await origin.boundingBox()).toEqual(before);
	expect(await peer.boundingBox()).toEqual(peerBefore);
	expect((await preview.boundingBox())!.y).toBeGreaterThan(before!.y);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect(preview).toHaveCount(0);
	expect(await origin.boundingBox()).toEqual(before);
	expect(await peer.boundingBox()).toEqual(peerBefore);
});

test("invalid targets and scroll-edge drags cancel without stale state", async ({ page }) => {
	await open(page, "view=timeGridDay&date=2026-10-21");
	await page.evaluate(() => window.tnc.calendar.setOptions({ slotHeight: 48 }));
	await page.evaluate(() => window.tnc.setItems([{ id: "edge", title: "Scroll-edge appointment", start: "2026-10-21T10:00", end: "2026-10-21T11:00" }]));
	const event = page.locator('.tnc-item[data-id="edge"]');
	await event.scrollIntoViewIfNeeded();
	const pointer = await center(event);
	await page.evaluate(() => window.tnc.calendar.setOptions({ canDrop: () => false }));
	await page.mouse.move(pointer.x, pointer.y);
	await page.mouse.down();
	await page.mouse.move(pointer.x, pointer.y + 40, { steps: 8 });
	await expect(page.locator(".tnc-drop-denied")).toHaveCount(1);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await page.evaluate(() => window.tnc.calendar.setOptions({ canDrop: () => true }));
	await event.scrollIntoViewIfNeeded();
	const origin = await center(event);
	const scroller = page.locator(".tnc-tg-scroll");
	const scrollTop = await scroller.evaluate(element => element.scrollTop);
	const bounds = (await scroller.boundingBox())!;
	await page.mouse.move(origin.x, origin.y);
	await page.mouse.down();
	await page.mouse.move(origin.x, bounds.y + bounds.height - 5, { steps: 12 });
	await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(scrollTop);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect(page.locator(".tnc-drag-origin, .tnc-dragging, .tnc-drop-denied")).toHaveCount(0);
	expect(await scroller.evaluate(element => element.scrollTop)).toBe(scrollTop);
});

test("pending, settled and reverted writes retain distinct states across refreshes", async ({ page }) => {
	await open(page, "view=timeGridDay&date=2026-10-21");
	await page.evaluate(() => {
		window.tnc.setItems([{ id: "write", title: "Write release notes", start: "2026-10-21T10:00", end: "2026-10-21T11:00" }]);
		window.tnc.calendar.setOptions({ onItemDrop: () => new Promise<void>(resolve => {
			(window as typeof window & { completeWrite: () => void }).completeWrite = resolve;
		}) });
	});
	const event = page.locator('.tnc-item[data-id="write"]');
	await event.focus();
	await page.keyboard.press("Alt+ArrowDown");
	await expect(event).toHaveAttribute("aria-busy", "true");
	await expect(event).toHaveClass(/is-write-pending/);
	await page.evaluate(() => window.tnc.setItems(window.tnc.items().map(item => ({ ...item, title: "Refreshed while saving" }))));
	await expect(event).toHaveAttribute("aria-busy", "true");
	await expect(event.locator(".tnc-resize-end")).toHaveCount(1);
	await page.evaluate(() => (window as typeof window & { completeWrite: () => void }).completeWrite());
	await expect(event).toHaveClass(/is-write-changed/);
	await expect(event).not.toHaveAttribute("aria-busy");
	await expect(event.locator(".tnc-resize-end")).toHaveCount(1);
	await page.evaluate(() => window.tnc.calendar.setOptions({ onItemDrop: arg => arg.revert() }));
	await event.focus();
	await page.keyboard.press("Alt+ArrowDown");
	await expect(event).toHaveClass(/is-write-failed/);
});

test("month overflow retains its focus anchor across item refreshes", async ({ page }) => {
	await open(page, "view=dayGridMonth&date=2026-10-21");
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ dayMaxEvents: 2 });
		window.tnc.setItems(Array.from({ length: 6 }, (_, index) => ({
			id: `month-${index}`, title: `Month appointment ${index + 1}`,
			start: "2026-10-21", data: { kind: "task" },
		})));
	});
	const trigger = page.locator(".tnc-dg .tnc-more").first();
	await trigger.click();
	await expect(page.locator(".tnc-popover")).toBeVisible();
	await page.evaluate(() => window.tnc.setItems(window.tnc.items().map(item => ({ ...item, title: `${item.title} refreshed` }))));
	await expect(page.locator(".tnc-popover .tnc-item").first()).toContainText("refreshed");
	await page.keyboard.press("Escape");
	await expect(page.locator(".tnc-popover")).toHaveCount(0);
	await expect(trigger).toBeFocused();
});

test("explicit stack limits measure only the columns actually displayed", async ({ page }) => {
	await open(page, "view=timeGridDay&date=2026-10-21");
	await page.addStyleTag({ content: ".tnc { width: 375px; }" });
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ eventMaxStack: 2, slotEventOverlap: false });
		window.tnc.setItems(Array.from({ length: 3 }, (_, index) => ({
			id: `legacy-${index}`, title: `Legacy appointment ${index + 1}`,
			start: "2026-10-21T10:00:00", end: "2026-10-21T11:00:00", data: { kind: "task" },
		})));
	});
	await expect(page.locator(".tnc-tg .tnc-item:visible")).toHaveCount(1);
	await expect(page.locator(".tnc-more--stack")).toHaveText("+2");
	await page.locator(".tnc-more--stack").click();
	await expect(page.locator(".tnc-popover .tnc-item")).toHaveCount(3);
});

test("busy days collapse into readable stacks without widening the week", async ({ page }) => {
	await open(page, "view=timeGridWeek&date=2026-10-21");
	await page.addStyleTag({ content: ".tnc-tg { --tnc-col-min: 128px; }" });
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ eventMaxStack: 0, slotEventOverlap: false });
		window.tnc.setItems([...Array.from({ length: 4 }, (_, index) => ({
			id: `collision-${index}`, title: `Readable appointment ${index + 1}`,
			start: "2026-10-21T10:00:00", end: "2026-10-21T11:00:00", data: { kind: "task" as const },
		})), { id: "morning", title: "Unrelated morning appointment", start: "2026-10-21T08:00:00", end: "2026-10-21T08:30:00", data: { kind: "task" as const } },
		{ id: "all-day", title: "Unrelated all-day task", start: "2026-10-21", data: { kind: "task" as const } }]);
	});
	const grid = page.locator(".tnc-tg");
	await expect.poll(() => grid.evaluate((element) => element.style.getPropertyValue("--tnc-collision-columns"))).toBe("4");
	expect(await grid.locator(".tnc-tg-scroll").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
	await expect(grid.locator(".tnc-collision-count")).toHaveText("4 appointments");
	await expect(grid.locator(".tnc-collision-title")).not.toBeEmpty();
	await grid.locator(".tnc-more--collision").click();
	await expect(page.locator(".tnc-popover .tnc-item")).toHaveCount(4);
	await expect(page.locator(".tnc-popover")).not.toContainText("Unrelated");
	await page.keyboard.press("Escape");
	await page.evaluate(() => window.tnc.setItems(window.tnc.items().slice(0, 1)));
	await expect.poll(() => grid.evaluate((element) => element.style.getPropertyValue("--tnc-collision-columns"))).toBe("1");
	await expect(grid.locator(".tnc-more--collision")).toHaveCount(0);
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ eventMaxStack: 2 });
		window.tnc.setItems(Array.from({ length: 4 }, (_, index) => ({
			id: `capped-${index}`, title: `Appointment ${index + 1}`,
			start: "2026-10-21T10:00:00", end: "2026-10-21T11:00:00", data: { kind: "task" },
		})));
	});
	await expect.poll(() => grid.evaluate((element) => element.style.getPropertyValue("--tnc-collision-columns"))).toBe("2");
	await grid.locator(".tnc-more--stack").focus();
	await page.keyboard.press("Enter");
	await expect(page.locator(".tnc-popover .tnc-item")).toHaveCount(4);
	await page.keyboard.press("Escape");
	await expect(grid.locator(".tnc-more--stack")).toBeFocused();
});

test("first entry and view switches reveal the selected day in a narrow week", async ({ page }) => {
	await page.setViewportSize({ width: 400, height: 800 });
	await open(page, "view=timeGridWeek&date=2026-10-21");
	await expect(page.locator('.tnc-dh[data-date="2026-10-21"]')).toBeInViewport();
	await page.selectOption(".tnc-toolbar-view-select", "month");
	await page.selectOption(".tnc-toolbar-view-select", "week");
	await expect(page.locator('.tnc-dh[data-date="2026-10-21"]')).toBeInViewport();
});

test("overflow clamps to the viewport on resize and Today reveals its day", async ({ page }) => {
	await open(page, "view=timeGridWeek&date=2026-10-21");
	await page.addStyleTag({ content: ".tnc-tg { --tnc-col-min: 128px; }" });
	await page.evaluate(() => window.tnc.setItems(Array.from({ length: 20 }, (_, index) => ({
		id: `overflow-${index}`, title: `Appointment ${index + 1} with a readable full title`,
		start: "2026-10-21T10:00:00", end: "2026-10-21T11:00:00", data: { kind: "task" },
	}))));
	await page.locator(".tnc-more--collision").click();
	await page.setViewportSize({ width: 440, height: 800 });
	const popover = page.locator(".tnc-popover");
	await expect.poll(() => popover.evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
	})).toBe(true);
	await expect(popover.locator(".tnc-popover-close")).toBeInViewport();
	expect(await popover.locator(".tnc-popover-body").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
	await page.keyboard.press("Tab");
	await expect(popover.locator(".tnc-popover-title")).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(popover.locator(".tnc-popover-close")).toBeFocused();
	await page.keyboard.press("End");
	await expect(popover.locator(".tnc-item").last()).toBeFocused();
	await expect(popover.locator(".tnc-item").last()).toBeInViewport();
	await page.keyboard.press("Home");
	await expect(popover.locator(".tnc-item").first()).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(page.locator(".tnc-more--collision")).toBeFocused();
	await page.locator(".tnc-btn-today").click();
	await expect(page.locator('.tnc-dh[data-date="2026-10-21"]')).toBeInViewport();
	const days = page.locator(".tnc-tg-day-navigation");
	await expect(days).toBeVisible();
	await days.getByRole("button").last().click();
	await expect(page.locator(".tnc-dh").last()).toBeInViewport();
});

test("view names become a select when the toolbar runs out of room", async ({ page }) => {
	await open(page, "view=timeGridWeek&date=2026-10-21");
	await page.setViewportSize({ width: 1180, height: 800 });
	await page.addStyleTag({ content: ".tnc-toolbar-start { flex: 1 1 auto; flex-wrap: wrap; } .tnc-toolbar-views { display: inline-flex; flex-wrap: nowrap; }" });
	await expect(page.locator(".tnc-toolbar-views")).toBeVisible();
	await page.setViewportSize({ width: 400, height: 800 });
	const select = page.locator(".tnc-toolbar-view-select");
	await expect(select).toBeVisible();
	await expect(page.locator(".tnc-toolbar-views")).toBeHidden();
	await select.selectOption("month");
	await expect(select).toHaveValue("month");
	expect(await page.evaluate(() => window.tnc.calendar.view.type)).toBe("month");
	await page.setViewportSize({ width: 1180, height: 800 });
	await expect(page.locator(".tnc-toolbar-views")).toBeVisible();
	await expect(page.locator(".tnc-btn-view-month")).toHaveAttribute("aria-pressed", "true");
});

test("empty lists accept a host-owned recovery action and remove it when populated", async ({ page }) => {
	await open(page, "view=listWeek&date=2030-01-01");
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ listEmptyContent: () => {
			const button = document.createElement("button");
			button.textContent = "Add a task";
			button.addEventListener("click", () => window.tnc.log.push("empty-action"));
			return button;
		} });
	});
	await page.getByRole("button", { name: "Add a task" }).click();
	expect(await page.evaluate(() => window.tnc.log.includes("empty-action"))).toBe(true);
	await page.evaluate(() => window.tnc.calendar.setOptions({ date: "2026-10-21" }));
	await expect(page.locator(".tnc-list-empty")).toHaveCount(0);
});
