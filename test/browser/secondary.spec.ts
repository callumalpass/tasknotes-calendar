import { expect, test } from "@playwright/test";
import { open } from "./helpers";

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
	await expect(grid.locator(".tnc-more--collision")).toHaveText("4 appointments");
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
	await grid.locator(".tnc-more--stack").click();
	await expect(page.locator(".tnc-popover .tnc-item")).toHaveCount(4);
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
