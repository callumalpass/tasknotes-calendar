import { expect, test } from "@playwright/test";
import { open } from "./helpers";

test("timed ranges follow width rather than duration and remain live during resize", async ({ page }) => {
	await open(page, "view=timeGridDay&date=2026-10-21");
	await page.evaluate(() => window.tnc.setItems([
		{ id: "short", title: "Short meeting", start: "2026-10-21T09:00", end: "2026-10-21T09:15" },
		{ id: "long", title: "Long meeting", start: "2026-10-21T10:00", end: "2026-10-21T11:30" },
	]));
	for (const id of ["short", "long"]) {
		await expect(page.locator(`.tnc-item[data-id="${id}"] .tnc-item-time-end`)).toBeVisible();
	}
	const event = page.locator('.tnc-item[data-id="long"]');
	await event.scrollIntoViewIfNeeded();
	const original = await event.boundingBox();
	const end = event.locator(".tnc-resize-end");
	await end.hover();
	const handle = (await end.boundingBox())!;
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2, handle.y + 45, { steps: 12 });
	await expect(page.locator(".tnc-dragging-resize-end")).toBeVisible();
	await expect(event.locator(".tnc-item-time-end")).toBeVisible();
	await expect(event.locator(".tnc-item-time-end")).not.toHaveText(" – 11:30");
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect.poll(async () => (await event.boundingBox())!.height).toBe(original!.height);
});

test("compact month chips reserve an unobscured line despite host recurrence borders", async ({ page }) => {
	await open(page, "view=dayGridMonth&date=2026-10-21");
	await page.setViewportSize({ width: 400, height: 800 });
	await page.addStyleTag({ content: ".legacy-recurring { border: 2px dashed; }" });
	await page.evaluate(() => {
		window.tnc.calendar.setOptions({ monthDisplay: "chips" });
		window.tnc.setItems([{ id: "recurring", title: "Daily planning", start: "2026-10-21", className: "legacy-recurring" }]);
	});
	const chip = page.locator('.tnc-item[data-id="recurring"]');
	const geometry = await chip.evaluate(element => {
		const style = getComputedStyle(element);
		return { height: element.clientHeight, title: element.querySelector(".tnc-item-title")!.getBoundingClientRect().height, top: style.borderTopWidth, bottom: style.borderBottomWidth };
	});
	expect(geometry.height).toBeGreaterThanOrEqual(geometry.title);
	expect(geometry.top).toBe("0px");
	expect(geometry.bottom).toBe("0px");
});
