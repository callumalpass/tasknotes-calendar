import type { Locator, Page } from "@playwright/test";

/** Fixed "today" so layouts are deterministic: Wednesday 21 Oct 2026, 08:00 London. */
export const NOW = new Date("2026-10-21T07:00:00Z");

export async function open(page: Page, query = "") {
	await page.clock.setFixedTime(NOW);
	await page.goto(`/?${query}`);
	await page.waitForFunction(() => !!window.tnc);
}

export function item(page: Page, id: string): Locator {
	return page.locator(`.tnc-item[data-id="${id}"]`).first();
}

export async function lastLog(page: Page, prefix: string): Promise<string | undefined> {
	return page.evaluate((p) => [...window.tnc.log].reverse().find((l) => l.startsWith(p)), prefix);
}

/** Centre of a time slot in a day column (minute from midnight). */
export async function slotPoint(page: Page, date: string, minute: number) {
	return page.evaluate(
		({ date, minute }) => {
			const col = document.querySelector<HTMLElement>(`.tnc-col[data-date="${date}"]`)!;
			const r = col.getBoundingClientRect();
			const { min, max } = window.tnc.calendar.slot;
			return { x: r.left + r.width / 2, y: r.top + ((minute - min) / (max - min)) * r.height };
		},
		{ date, minute },
	);
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 2, from.y + 6, { steps: 2 });
	await page.mouse.move(to.x, to.y, { steps });
	await page.mouse.up();
}

export async function center(loc: Locator) {
	await loc.scrollIntoViewIfNeeded();
	const b = (await loc.boundingBox())!;
	return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 12) };
}
