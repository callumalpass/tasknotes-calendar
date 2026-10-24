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
}

const BAR_GAP = 2;

/** Month view: weeks of day cells with items stacked in rows. */
export class DayGridView<D> implements View {
	readonly el: HTMLElement;
	private readonly scroller: HTMLElement;
	private readonly grid: HTMLElement;
	private weeks: Week<D>[] = [];
	private resizeObs: ResizeObserver | null = null;
	private barPx = 20;
	private lastHeights = "";

	constructor(private readonly ctx: ViewContext<D>) {
		const { doc, opts, days } = ctx;
		this.el = h(doc, "div", "tnc-dg");
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
			const row = h(doc, "div", "tnc-dg-week", { role: "row" });
			if (opts.weekNumbers) row.append(h(doc, "div", "tnc-weeknum", null, ctx.text.weekNumber(isoWeekNumber(wdays[0]!))));
			const cells = wdays.map((d) => {
				const arg = ctx.dayArg(d);
				const cls = ["tnc-dg-day", ...ctx.dayClasses(d)];
				if (ymdOfDay(d).month !== anchorMonth) cls.push("is-other-month");
				const cell = h(doc, "div", cls.join(" "), { role: "gridcell", "data-date": arg.dateStr });
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
				row.append(cell);
				return cell;
			});
			const layer = h(doc, "div", "tnc-dg-layer");
			const sel = h(doc, "div", "tnc-sel-layer");
			const more = h(doc, "div", "tnc-more-layer");
			layer.append(sel, more);
			row.append(layer);
			this.grid.append(row);
			this.weeks.push({ days: wdays, row, cells, layer, sel, more, pool: new ItemPool(ctx, layer) });
		}
		this.scroller.append(this.grid);
		this.el.append(this.scroller);
		this.el.classList.toggle("tnc-dg--auto", opts.height === "auto");

		const RO = (ctx.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
		if (RO && opts.dayMaxEvents === true) {
			this.resizeObs = new RO(() => {
				const key = this.weeks.map((w) => w.row.clientHeight).join(",");
				if (key !== this.lastHeights) this.render(null);
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

	render(_change: StoreChange | null): void {
		const { ctx } = this;
		const cs = ctx.win.getComputedStyle(this.el);
		this.barPx = parseFloat(cs.getPropertyValue("--tnc-bar-h")) || 20;
		this.lastHeights = this.weeks.map((w) => w.row.clientHeight).join(",");
		for (const w of this.weeks) this.renderWeek(w);
	}

	private limitFor(w: Week<D>): number {
		const { dayMaxEvents, dayMaxEventRows, height } = this.ctx.opts;
		if (dayMaxEventRows > 0) return dayMaxEventRows;
		if (typeof dayMaxEvents === "number" && dayMaxEvents > 0) return dayMaxEvents + 1;
		if (dayMaxEvents === true) {
			if (height === "auto") return 5;
			const top = w.cells[0]?.querySelector<HTMLElement>(".tnc-dg-top")?.offsetHeight ?? 22;
			const avail = w.row.clientHeight - top - 4;
			return Math.max(1, Math.floor(avail / (this.barPx + BAR_GAP)));
		}
		return 0;
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
		const visible = (col: number) => (limit && (row.countByCol[col] ?? 0) > limit ? limit - 1 : limit || Infinity);
		const n = w.days.length;
		const hidden = new Array<NormalizedItem<D>[]>(n).fill([]).map(() => [] as NormalizedItem<D>[]);
		w.pool.begin();
		let maxLevel = -1;
		for (const p of row.placements) {
			let show = true;
			for (let c = p.startCol; c < p.endCol; c++) if (p.level >= visible(c)) show = false;
			if (!show) {
				for (let c = p.startCol; c < p.endCol; c++) hidden[c]!.push(p.item);
				continue;
			}
			maxLevel = Math.max(maxLevel, p.level);
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
				top: `calc(var(--tnc-dg-top-h) + ${p.level} * (var(--tnc-bar-h) + ${BAR_GAP}px))`,
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
		const levels = maxLevel + 1 + (hidden.some((x) => x.length) ? 1 : 0);
		w.row.style.setProperty("--tnc-levels", String(levels));
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
		return this.weeks.flatMap((w) => w.pool.elementsFor(id));
	}

	destroy(): void {
		this.resizeObs?.disconnect();
		for (const w of this.weeks) w.pool.clear();
		this.el.remove();
	}
}
