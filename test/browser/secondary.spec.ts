import { expect, test } from "@playwright/test";
import { open } from "./helpers";

test("hosts can reserve readable collision columns and widths shrink after incremental removal", async ({ page }) => {
	await open(page, "view=timeGridWeek&date=2026-10-21");
	await page.addStyleTag({ content: ".tnc-tg { --tnc-col-min: max(180px, calc(var(--tnc-collision-columns, 1) * 120px)); }" });
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ eventMaxStack: 0, slotEventOverlap: false });
		window.tnc.setItems(Array.from({ length: 4 }, (_, index) => ({
			id: `collision-${index}`, title: `Readable appointment ${index + 1}`,
			start: "2026-10-21T10:00:00", end: "2026-10-21T11:00:00", data: { kind: "task" },
		})));
	});
	const grid = page.locator(".tnc-tg");
	await expect.poll(() => grid.evaluate((element) => element.style.getPropertyValue("--tnc-collision-columns"))).toBe("4");
	expect(await grid.locator(".tnc-tg-scroll").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
	for (const event of await grid.locator(".tnc-item--timed").all()) expect((await event.boundingBox())!.width).toBeGreaterThan(110);
	await page.evaluate(() => window.tnc.setItems(window.tnc.items().slice(0, 1)));
	await expect.poll(() => grid.evaluate((element) => element.style.getPropertyValue("--tnc-collision-columns"))).toBe("1");
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
