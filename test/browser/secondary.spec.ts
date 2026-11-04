import { expect, test } from "@playwright/test";
import { open } from "./helpers";

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
