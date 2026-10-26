import { type Day, isoWeekNumber, ymdOfDay } from "../../core/date";
import { layoutRow } from "../../core/layout";
import type { StoreChange } from "../../core/store";
import type { NormalizedItem } from "../../core/types";
import { ItemPool, type Selection, type View, type ViewContext } from "../context";
import { h, pct, setStyle } from "../dom";
import type { Hit } from "../options";

interface Week<D> {
	days: Day[];
	row: HTMLElement;
	cells: HTMLElement[];
	layer: HTMLElement;
	sel: HTMLElement;
	more: HTMLElement;
	pool: ItemPool<D>;
	/** `monthDisplay: "dots"`: one dot box per cell. */
	dots: { box: HTMLElement; pool: ItemPool<D>; count: HTMLElement }[] | null;
}

const BAR_GAP = 2;
/** Space below the last row of a day cell. */
const CELL_PAD = 6;

/** How many bar rows a day cell shows: `fit` when everything fits, `withMore` above a "+N more" link. */
interface Limit {
	fit: number;
	withMore: number;
}

/** Reads a px length from a custom property. */
function px(cs: CSSStyleDeclaration, name: string, fallback: number): number {
	const v = parseFloat(cs.getPropertyValue(name));
	return Number.isFinite(v) ? v : fallback;
}

/** Month view: weeks of day cells with items stacked in rows. */
export class DayGridView<D> implements View {
	readonly el: HTMLElement;
	private readonly scroller: HTMLElement;
	private readonly grid: HTMLElement;
	private weeks: Week<D>[] = [];
	private resizeObs: ResizeObserver | null = null;
	private barPx = 20;
	private morePx = 20;
	private topPx = 24;
	private lastHeights = "";
	private readonly dotsMode: boolean;

	constructor(private readonly ctx: ViewContext<D>) {
		const { doc, opts, days } = ctx;
		this.dotsMode = opts.monthDisplay === "dots";
		this.el = h(doc, "div", this.dotsMode ? "tnc-dg tnc-dg--dots" : "tnc-dg");
		this.scroller = h(doc, "div", "tnc-dg-scroll");
		this.grid = h(doc, "div", "tnc-dg-grid", { role: "grid", "aria-label": ctx.view.title });
		const perWeek = this.daysPerWeek();
		const cols = `${opts.weekNumbers ? "var(--tnc-weeknum-w) " : ""}repeat(${perWeek}, minmax(0, 1fr))`;
		this.el.style.setProperty("--tnc-cols", cols);

		const head = h(doc, "div", "tnc-dg-head", { role: "row" });
		if (opts.weekNumbers) head.append(h(doc, "div", "tnc-weeknum-head"));
		for (const d of days.slice(0, perWeek)) {
			const arg = ctx.dayArg(d);
			const cell = h(doc, "div", "tnc-dg-dow", { role: "columnheader", "aria-label": ctx.fmt.weekdayLong(d) });
			const custom = opts.dayHeaderContent?.(arg);
			cell.append(custom ?? ctx.fmt.weekdayShort(d));
			head.append(cell);
			opts.dayHeaderDidMount?.({ ...arg, el: cell });
		}
		this.grid.append(head);

		const anchorMonth = ymdOfDay(ctx.view.anchor).month;
		for (let i = 0; i < days.length; i += perWeek) {
			const wdays = days.slice(i, i + perWeek);
			const row = h(doc, "div", "tnc-dg-week", { role: "rowgroup" });
			const dates = h(doc, "div", "tnc-dg-dates", { role: "row" });
			if (opts.weekNumbers) dates.append(h(doc, "div", "tnc-weeknum", { role: "rowheader" }, ctx.text.weekNumber(isoWeekNumber(wdays[0]!))));
			const cells = wdays.map((d) => {
				const arg = ctx.dayArg(d);
				const cls = ["tnc-dg-day", ...ctx.dayClasses(d)];
				if (ymdOfDay(d).month !== anchorMonth) cls.push("is-other-month");
				const cell = h(doc, "div", cls.join(" "), { role: "gridcell", "aria-label": ctx.fmt.longDate(d), "data-date": arg.dateStr });
				if (this.dotsMode) cell.tabIndex = 0;
				const num = ctx.fmt.dayNumber(d);
				const label = ymdOfDay(d).day === 1 ? `${ctx.fmt.monthShort(d)} ${num}` : num;
				cell.append(
					h(
						doc,
						"div",
						"tnc-dg-top",
						null,
						opts.navLinks ? ctx.navLink(d, label, "tnc-dg-num") : h(doc, "span", "tnc-dg-num", null, label),
					),
				);
				dates.append(cell);
				return cell;
			});
			// Spanning bars occupy one full-width cell below the row of dates.
			const layer = h(doc, "div", "tnc-dg-layer", { role: "row" });
			const content = h(doc, "div", "tnc-dg-content", { role: "gridcell", "aria-colspan": String(perWeek), "aria-label": ctx.fmt.range(wdays[0]!, wdays[wdays.length - 1]!) });
			const sel = h(doc, "div", "tnc-sel-layer");
			const more = h(doc, "div", "tnc-more-layer");
			content.append(sel, more);
			layer.append(content);
			row.append(dates, layer);
			this.grid.append(row);
			const dots = this.dotsMode
				? cells.map((cell) => {
						const box = h(doc, "div", "tnc-dg-dots", { "aria-hidden": "true" });
						if (opts.dayMaxEvents === false) box.classList.add("is-unlimited");
						const count = h(doc, "span", "tnc-dg-dots-more");
						cell.append(box);
						return { box, pool: new ItemPool(ctx, box), count };
					})
				: null;
			this.weeks.push({ days: wdays, row, cells, layer, sel, more, pool: new ItemPool(ctx, content), dots });
		}
		this.scroller.append(this.grid);
		this.el.append(this.scroller);
		this.el.classList.toggle("tnc-dg--auto", opts.height === "auto");

		const RO = (ctx.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
		// Measured limits follow the cell size: row heights for bars, and the width too for dots.
		if (RO && (opts.dayMaxEvents === true || (this.dotsMode && opts.dayMaxEvents !== false))) {
			this.resizeObs = new RO(() => {
				if (this.sizeKey() !== this.lastHeights) this.render(null);
			});
			this.resizeObs.observe(this.grid);
		}
	}

	private daysPerWeek(): number {
		const { days } = this.ctx;
		const first = days[0];
		if (first === undefined) return 7;
		let n = 0;
		while (n < days.length && days[n]! < first + 7) n++;
		return n || 7;
	}

	private sizeKey(): string {
		return `${this.grid.clientWidth}|${this.weeks.map((w) => w.row.clientHeight).join(",")}`;
	}

	render(_change: StoreChange | null): void {
		const { ctx } = this;
		const cs = ctx.win.getComputedStyle(this.el);
		this.barPx = px(cs, "--tnc-bar-h", 20);
		this.topPx = this.weeks[0]?.cells[0]?.querySelector<HTMLElement>(".tnc-dg-top")?.offsetHeight || px(cs, "--tnc-dg-top-h", 24);
		this.morePx = this.measureMore(cs);
		this.lastHeights = this.sizeKey();
		for (const w of this.weeks) {
			if (w.dots) this.renderDots(w);
			else this.renderWeek(w);
		}
	}

	/** Height of a "+N more" link as the host styles it (`--tnc-more-h`, or a taller min-height). */
	private measureMore(cs: CSSStyleDeclaration): number {
		const fallback = px(cs, "--tnc-more-h", this.barPx);
		const layer = this.weeks[0]?.more;
		if (this.dotsMode || !layer) return fallback;
		const probe = h(this.ctx.doc, "button", "tnc-more", { type: "button", tabindex: "-1", "aria-hidden": "true" }, "+0");
		probe.style.visibility = "hidden";
		layer.append(probe);
		const measured = probe.offsetHeight;
		probe.remove();
		return Math.max(fallback, measured);
	}

	private limitFor(w: Week<D>): Limit | null {
		const { dayMaxEvents, dayMaxEventRows, height } = this.ctx.opts;
		const rows = (n: number): Limit => ({ fit: n, withMore: n - 1 });
		if (dayMaxEventRows > 0) return rows(dayMaxEventRows);
		if (typeof dayMaxEvents === "number" && dayMaxEvents > 0) return rows(dayMaxEvents + 1);
		if (dayMaxEvents !== true) return null;
		if (height === "auto") return rows(5);
		const step = this.barPx + BAR_GAP;
		const avail = w.row.clientHeight - this.topPx - CELL_PAD;
		return {
			fit: Math.max(1, Math.floor((avail + BAR_GAP) / step)),
			withMore: Math.max(0, Math.floor((avail - this.morePx) / step)),
		};
	}

	private itemsFor(w: Week<D>): NormalizedItem<D>[] {
		const { store } = this.ctx;
		const first = w.days[0]!;
		const last = w.days[w.days.length - 1]!;
		const out = store.spanningIn(first, last + 1, true).filter((n) => n.item.display !== "background");
		const seen = new Set(out.map((n) => n.id));
		for (const d of w.days) {
			for (const n of store.timedOn(d)) {
				if (seen.has(n.id) || n.item.display === "background") continue;
				seen.add(n.id);
				out.push(n);
			}
		}
		return out;
	}

	private renderWeek(w: Week<D>): void {
		const { ctx } = this;
		const row = layoutRow(this.itemsFor(w), w.days, ctx.order);
		const limit = this.limitFor(w);
		const visible = (col: number) => (!limit ? Infinity : (row.countByCol[col] ?? 0) > limit.fit ? limit.withMore : limit.fit);
		const n = w.days.length;
		const hidden = new Array<NormalizedItem<D>[]>(n).fill([]).map(() => [] as NormalizedItem<D>[]);
		w.pool.begin();
		let maxLevel = -1;
		for (const p of row.placements) {
			let level = p.level;
			let room = Infinity;
			for (let c = p.startCol; c < p.endCol; c++) room = Math.min(room, visible(c));
			if (level >= room) {
				// The item being dragged always shows, in the last row that has room, so the preview never hides behind "+N more".
				if (p.item.id !== ctx.draggingId) {
					for (let c = p.startCol; c < p.endCol; c++) hidden[c]!.push(p.item);
					continue;
				}
				level = Math.max(0, room - 1);
			}
			maxLevel = Math.max(maxLevel, level);
			const single = !p.item.allDay && p.item.endDay - p.item.startDay <= 1;
			const el = w.pool.place(p.item.id, {
				n: p.item,
				day: w.days[p.startCol]!,
				isStart: p.isStart,
				isEnd: p.isEnd,
				variant: single ? "dot" : "bar",
				mirror: false,
			});
			setStyle(el, {
				left: `calc(${pct(p.startCol / n)} + 2px)`,
				width: `calc(${pct((p.endCol - p.startCol) / n)} - 4px)`,
				top: `calc(var(--tnc-dg-top-h) + ${level} * (var(--tnc-bar-h) + ${BAR_GAP}px))`,
			});
		}
		w.pool.end();
		w.more.replaceChildren();
		hidden.forEach((items, col) => {
			if (!items.length) return;
			const day = w.days[col]!;
			const link = h(ctx.doc, "button", "tnc-more", { type: "button", "aria-haspopup": "dialog" }, ctx.text.more(items.length));
			setStyle(link, {
				left: `calc(${pct(col / n)} + 2px)`,
				width: `calc(${pct(1 / n)} - 4px)`,
				top: `calc(var(--tnc-dg-top-h) + ${visible(col)} * (var(--tnc-bar-h) + ${BAR_GAP}px))`,
			});
			link.addEventListener("click", (ev) => ctx.openMore(day, link, ev));
			w.more.append(link);
		});
		// Height the tallest cell needs: its bars, plus the "+N more" link at its real height.
		const step = this.barPx + BAR_GAP;
		let need = maxLevel >= 0 ? (maxLevel + 1) * step - BAR_GAP : 0;
		hidden.forEach((items, col) => {
			if (items.length) need = Math.max(need, visible(col) * step + this.morePx);
		});
		w.row.style.setProperty("--tnc-levels", String(maxLevel + 1));
		w.row.style.setProperty("--tnc-dg-need", `${this.topPx + need + CELL_PAD}px`);
	}

	/** Items touching one day, all-day first, as a dot cell lists them. */
	private itemsOn(day: Day): NormalizedItem<D>[] {
		const { store } = this.ctx;
		const out = store.spanningIn(day, day + 1, true);
		const seen = new Set(out.map((n) => n.id));
		for (const n of store.timedOn(day)) if (!seen.has(n.id)) out.push(n);
		return out
			.filter((n) => n.item.display !== "background" && n.item.display !== "none")
			.sort((a, b) => Number(b.allDay) - Number(a.allDay) || this.ctx.order(a, b));
	}

	/** `monthDisplay: "dots"`: each cell wraps one dot per item, then "+N" for the rest. */
	private renderDots(w: Week<D>): void {
		const { ctx } = this;
		const { dayMaxEvents } = ctx.opts;
		const first = w.dots![0]!.box;
		const cs = ctx.win.getComputedStyle(first);
		const size = px(cs, "--tnc-dot-size", 8);
		const gap = px(cs, "--tnc-dot-gap", 3);
		const step = size + gap;
		const perRow = Math.max(1, Math.floor((first.clientWidth + gap) / step));
		const rows = Math.max(1, Math.floor((first.clientHeight + gap) / step));
		const fits = dayMaxEvents === false ? Infinity : perRow * rows;
		const cap = typeof dayMaxEvents === "number" && dayMaxEvents > 0 ? Math.min(dayMaxEvents, fits) : fits;
		w.row.style.setProperty("--tnc-levels", "0");
		w.row.style.removeProperty("--tnc-dg-need");
		w.days.forEach((day, i) => {
			const cell = w.dots![i]!;
			const items = this.itemsOn(day);
			// "+N" takes about two dot slots when the cell is full.
			const shown = items.length <= cap ? items.length : cap >= fits ? Math.max(0, cap - 2) : cap;
			cell.pool.begin();
			const els = items
				.slice(0, shown)
				.map((n) => cell.pool.place(n.id, { n, day, isStart: n.startDay >= day, isEnd: n.endDay <= day + 1, variant: "indicator", mirror: false }));
			cell.pool.end();
			// Keep DOM order equal to item order.
			els.forEach((el, k) => {
				if (cell.box.children[k] !== el) cell.box.insertBefore(el, cell.box.children[k] ?? null);
			});
			const rest = items.length - shown;
			cell.count.textContent = rest > 0 ? `+${rest}` : "";
			if (rest > 0) cell.box.append(cell.count);
			else cell.count.remove();
			const label = ctx.fmt.longDate(day);
			w.cells[i]!.setAttribute("aria-label", items.length ? `${label}, ${ctx.text.itemCount(items.length)}` : label);
		});
	}

	showSelection(sel: Selection | null): void {
		for (const w of this.weeks) {
			w.sel.replaceChildren();
			if (!sel) continue;
			const n = w.days.length;
			const startCol = w.days.findIndex((d) => d >= sel.startDay);
			if (startCol < 0) continue;
			let endCol = w.days.findIndex((d) => d >= sel.endDay);
			if (endCol < 0) endCol = n;
			if (endCol <= startCol) continue;
			const box = h(this.ctx.doc, "div", "tnc-sel");
			setStyle(box, { left: pct(startCol / n), width: pct((endCol - startCol) / n), top: "0", bottom: "0" });
			w.sel.append(box);
		}
	}

	hit(x: number, y: number): Hit | null {
		for (const w of this.weeks) {
			const r = w.row.getBoundingClientRect();
			if (y < r.top || y >= r.bottom) continue;
			for (let i = 0; i < w.cells.length; i++) {
				const cr = w.cells[i]!.getBoundingClientRect();
				if (x >= cr.left && x < cr.right) return { kind: "day", day: w.days[i]! };
			}
		}
		return null;
	}

	getScroll() {
		return { top: this.scroller.scrollTop, left: 0 };
	}

	setScroll(s: { top: number; left: number }) {
		this.scroller.scrollTop = s.top;
	}

	elementsFor(id: string): HTMLElement[] {
		return this.weeks.flatMap((w) => [...w.pool.elementsFor(id), ...(w.dots ?? []).flatMap((c) => c.pool.elementsFor(id))]);
	}

	destroy(): void {
		this.resizeObs?.disconnect();
		for (const w of this.weeks) {
			w.pool.clear();
			for (const c of w.dots ?? []) c.pool.clear();
		}
		this.el.remove();
	}
}
