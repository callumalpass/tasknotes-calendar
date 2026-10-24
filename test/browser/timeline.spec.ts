import { expect, type Page, test } from "@playwright/test";
import { center, drag, item, lastLog, open } from "./helpers";

/** Centre of a bar's link handle (shown on hover). */
async function port(page: Page, id: string, edge: "start" | "finish") {
	const bar = item(page, id);
	await bar.scrollIntoViewIfNeeded();
	await bar.hover();
	return center(bar.locator(`.tnc-port-${edge}`));
}

async function dayWidth(page: Page) {
	return page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".tnc-tl")!).getPropertyValue("--tnc-tl-day-w")));
}

test.describe("timeline", () => {
	test("start and finish handles create each relationship type, drawn from the right edges", async ({ page }) => {
		await open(page, "view=timeline");
		await drag(page, await port(page, "p-app-research", "start"), await port(page, "p-web-build", "start"));
		await expect.poll(() => lastLog(page, "link")).toBe("link p-app-research SS -> p-web-build");
		await drag(page, await port(page, "p-web-build", "finish"), await port(page, "p-app-wireframes", "finish"));
		await expect.poll(() => lastLog(page, "link")).toBe("link p-web-build FF -> p-app-wireframes");
		// Dropping on a bar's body picks the nearer edge.
		const body = (await item(page, "p-web-wireframes").boundingBox())!;
		await drag(page, await port(page, "p-app-wireframes", "start"), { x: body.x + 4, y: body.y + body.height / 2 });
		await expect.poll(() => lastLog(page, "link")).toBe("link p-app-wireframes SS -> p-web-wireframes");
		// canLink refuses a cycle.
		await drag(page, await port(page, "p-web-build", "finish"), await port(page, "p-app-research", "start"));
		await expect.poll(() => lastLog(page, "link")).toBe("link refused: That would create a cycle");

		// An SS arrow leaves the predecessor's start edge and enters the successor's start edge.
		const geometry = await page.evaluate(() => {
			const path = document.querySelector<SVGPathElement>('.tnc-tl-deps path[data-from="p-app-research"][data-to="p-web-build"]')!;
			const from = document.querySelector<HTMLElement>('.tnc-item[data-id="p-app-research"]')!;
			const to = document.querySelector<HTMLElement>('.tnc-item[data-id="p-web-build"]')!;
			const d = path.getAttribute("d")!;
			return { type: path.dataset.type, x1: Number(/^M([\d.-]+)/.exec(d)![1]), xEnd: Number(/H([\d.-]+)$/.exec(d)![1]), fromLeft: from.offsetLeft, toLeft: to.offsetLeft };
		});
		expect(geometry.type).toBe("SS");
		expect(geometry.x1).toBe(geometry.fromLeft);
		expect(geometry.xEnd).toBe(geometry.toLeft - 2);

		// The website's QA overlaps Build start-to-start (holds); the app's QA is finish-to-start (conflict).
		await expect(item(page, "p-web-qa")).not.toHaveClass(/is-conflict/);
		await expect(item(page, "p-app-qa")).toHaveClass(/is-conflict/);
	});

	test("external drops land on headings and the date header, not on labels or outside", async ({ page }) => {
		await open(page, "view=timeline");
		const card = (title: string) => page.locator(`.card[data-title="${title}"]`);
		const head = (await page.locator(".tnc-tl-ticks").boundingBox())!;
		const group = (await page.locator('.tnc-tl-row[data-row="p-app"] .tnc-tl-track').boundingBox())!;
		const label = (await page.locator('.tnc-tl-row[data-row="p-web-build"] .tnc-tl-label').boundingBox())!;
		const dayW = await dayWidth(page);

		await drag(page, await center(card("Read RFC")), { x: group.x + dayW * 16.5, y: group.y + group.height / 2 }, 14);
		await expect.poll(() => lastLog(page, "external")).toBe("external Read RFC 2026-10-23 → 2026-10-24 area=track");
		await drag(page, await center(card("Call the bank")), { x: head.x + dayW * 18.5, y: head.y + 30 }, 14);
		await expect.poll(() => lastLog(page, "external")).toBe("external Call the bank 2026-10-25 → 2026-10-26 area=header");
		await drag(page, await center(card("Order printer ink")), { x: label.x + 20, y: label.y + label.height / 2 }, 14);
		await expect.poll(() => lastLog(page, "external")).toBe("external Order printer ink not dropped");

		const hits = await page.evaluate(
			({ head, label }) => {
				const cal = window.tnc.calendar;
				return { header: cal.hitTest(label.x + label.width + 50, head.y + 30), label: cal.hitTest(label.x + 5, label.y + 5), outside: cal.hitTest(head.x, 2) };
			},
			{ head, label },
		);
		expect(hits.header).toMatchObject({ kind: "timeline", area: "header", rowId: null, overTrack: false, day: expect.any(Number) });
		expect(hits.label).toMatchObject({ area: "label", rowId: "p-web-build", overTrack: false });
		expect(hits.outside).toBeNull();
	});

	test("narrow bars drop their grips and title but still move and click", async ({ page }) => {
		await open(page, "view=timeline");
		await page.evaluate(() => {
			const cal = window.tnc.calendar;
			cal.setOptions({ timeline: { ...cal.getOptions().timeline!, scale: { unit: "week", dayWidth: 4, snapMinutes: 1440 } } });
		});
		const bar = item(page, "p-app-research"); // 4 days = 16px
		await expect(bar).toHaveClass(/is-narrow/);
		await expect(bar.locator(".tnc-item-title")).toBeHidden();
		await expect(bar.locator(".tnc-resize").first()).toBeHidden();
		const from = await center(bar);
		await page.mouse.click(from.x, from.y);
		await expect.poll(() => lastLog(page, "click")).toBe("click p-app-research");
		await drag(page, from, { x: from.x + 12, y: from.y });
		await expect.poll(() => lastLog(page, "drop")).toMatch(/^drop p-app-research 2026-10-27 → 2026-10-31/);
	});

	test("zooming keeps the date under the pointer; date changes keep the scroll; scrollToDate scrolls smoothly", async ({ page }) => {
		await open(page, "view=timeline");
		const track = (await page.locator('.tnc-tl-row[data-row="p-web-build"] .tnc-tl-track').boundingBox())!;
		const x = track.x + 500;
		const y = track.y + 5;
		const dayAt = () => page.evaluate(({ x, y }) => (window.tnc.calendar.hitTest(x, y) as { day: number }).day, { x, y });
		const before = await dayAt();
		await page.evaluate((x) => {
			const cal = window.tnc.calendar;
			cal.setOptions({ timeline: { ...cal.getOptions().timeline!, scale: { unit: "day", dayWidth: 60, snapMinutes: 1440 } } }, { anchor: { clientX: x } });
		}, x);
		expect(await dayAt()).toBe(before);

		await page.evaluate(() => window.tnc.calendar.setOptions({ date: "2026-10-01" }));
		expect(await dayAt()).toBe(before);

		const scroller = page.locator(".tnc-tl-scroll");
		await page.evaluate(() => window.tnc.calendar.scrollToDate("2026-11-20T12:00", { align: "center", smooth: true }));
		const early = await scroller.evaluate((e) => e.scrollLeft);
		await expect
			.poll(() =>
				page.evaluate(() => {
					const s = document.querySelector<HTMLElement>(".tnc-tl-scroll")!;
					const r = s.getBoundingClientRect();
					const cx = r.left + 240 + (s.clientWidth - 240) / 2;
					return (window.tnc.calendar.hitTest(cx, r.top + 60) as { day: number }).day;
				}),
			)
			.toBe(Date.UTC(2026, 10, 20) / 86_400_000);
		// It animated rather than jumping there.
		expect(Math.abs((await scroller.evaluate((e) => e.scrollLeft)) - early)).toBeGreaterThan(50);
	});

	test("row labels mount and unmount through hooks, and the click ending a drag never reaches them", async ({ page }) => {
		await open(page, "view=timeline");
		await page.evaluate(() => {
			const cal = window.tnc.calendar;
			const w = window as unknown as { labels: string[] };
			w.labels = [];
			cal.setOptions({
				timeline: {
					...cal.getOptions().timeline!,
					rowLabelDidMount: ({ row, el }) => {
						w.labels.push(`mount ${row.id}`);
						el.textContent = row.title;
						// A listener on the label itself, as React attaches to portal containers.
						el.addEventListener("click", () => w.labels.push(`click ${row.id}`));
						// Start an external drag once the pointer moves, as a task list would.
						el.addEventListener("pointerdown", () => {
							const move = (ev: PointerEvent) => {
								document.removeEventListener("pointermove", move);
								cal.beginExternalDrag(ev, { title: row.title });
							};
							document.addEventListener("pointermove", move);
							document.addEventListener("pointerup", () => document.removeEventListener("pointermove", move), { once: true });
						});
					},
					rowLabelWillUnmount: ({ row }) => w.labels.push(`unmount ${row.id}`),
				},
			});
		});
		const label = await center(page.locator('.tnc-tl-row[data-row="p-web-qa"] .tnc-tl-label'));
		await page.mouse.click(label.x, label.y);
		await drag(page, label, { x: label.x + 30, y: label.y });
		const logs = () => page.evaluate(() => (window as unknown as { labels: string[] }).labels);
		expect((await logs()).filter((l) => l.startsWith("click"))).toEqual(["click p-web-qa"]);

		await page.evaluate(() => {
			const cal = window.tnc.calendar;
			const t = cal.getOptions().timeline!;
			cal.setOptions({ timeline: { ...t, rows: t.rows.filter((r) => r.id !== "p-web-qa") } });
		});
		expect(await logs()).toContain("unmount p-web-qa");
		expect((await logs()).filter((l) => l === "mount p-web-research")).toHaveLength(1);
	});

	test("arrow keys on a focused grip move that edge", async ({ page }) => {
		await open(page, "view=timeline");
		const grip = page.getByRole("button", { name: "Change Research start" }).last();
		await grip.focus();
		await page.keyboard.press("ArrowLeft");
		await expect.poll(() => lastLog(page, "resize")).toBe("resize p-app-research 2026-10-23 → 2026-10-28 (all-day)");
		await expect(page.getByRole("button", { name: "Change Research start" }).last()).toBeFocused();
		// The host saving the change rebuilds the bar; focus moves to the new grip.
		await page.evaluate(() => {
			const cal = window.tnc.calendar;
			cal.setItems(window.tnc.items().map((i) => (i.id === "p-app-research" ? { ...i, rev: "saved" } : i)));
			cal.flush();
		});
		await expect(page.getByRole("button", { name: "Change Research start" }).last()).toBeFocused();
	});
});

test("@touch timeline: tapping selects a bar and shows its link handles; long press moves it", async ({ page }) => {
	await open(page, "view=timeline");
	// Calendar only, with a narrow label column, so a bar and its neighbour fit on a phone.
	await page.evaluate(() => {
		document.getElementById("side")!.style.display = "none";
		const cal = window.tnc.calendar;
		cal.setOptions({ timeline: { ...cal.getOptions().timeline!, labelWidth: 100 } });
		cal.scrollToDate("2026-10-23", { align: "start" });
	});
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
		cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
	const bar = item(page, "p-app-research");
	const finish = bar.locator(".tnc-port-finish");
	await bar.scrollIntoViewIfNeeded();
	await expect(finish).toBeHidden();
	const b = (await bar.boundingBox())!;
	await touch("touchStart", b.x + 30, b.y + b.height / 2);
	await touch("touchEnd", b.x + 30, b.y + b.height / 2);
	await expect(bar).toHaveClass(/is-selected/);
	await expect(finish).toBeVisible();
	const handle = (await finish.boundingBox())!;
	expect(handle.width).toBeGreaterThanOrEqual(44);

	const target = (await item(page, "p-app-wireframes").boundingBox())!;
	const sx = handle.x + handle.width / 2;
	const sy = handle.y + handle.height / 2;
	const tx = target.x + 50;
	const ty = target.y + target.height / 2;
	await touch("touchStart", sx, sy);
	for (let i = 1; i <= 6; i++) await touch("touchMove", sx + ((tx - sx) * i) / 6, sy + ((ty - sy) * i) / 6);
	await touch("touchEnd", tx, ty);
	await expect.poll(() => lastLog(page, "link")).toBe("link p-app-research FS -> p-app-wireframes");

	const c = (await bar.boundingBox())!;
	const x = c.x + c.width / 2;
	const y = c.y + c.height / 2;
	const dayW = await dayWidth(page);
	await touch("touchStart", x, y);
	await page.waitForTimeout(450);
	for (let i = 1; i <= 4; i++) await touch("touchMove", x + (dayW * 2 * i) / 4, y);
	await touch("touchEnd", x + dayW * 2, y);
	await expect.poll(() => lastLog(page, "drop")).toMatch(/^drop p-app-research 2026-10-26 → /);
});
