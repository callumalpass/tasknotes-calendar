import { type Day, isoWeekNumber, MINUTES_PER_DAY } from "../../core/date";
import { layoutRow, layoutTimedDay, type TimedPlacement, type TimedSegment } from "../../core/layout";
import { plannedMinutes } from "../../core/plan";
import type { StoreChange } from "../../core/store";
import type { NormalizedItem } from "../../core/types";
import { toInstant, wallTime } from "../../core/zone";
import { ItemPool, type Selection, type View, type ViewContext } from "../context";
import { h, pct, setStyle } from "../dom";
import type { Hit } from "../options";

interface Column<D> {
	day: Day;
	head: HTMLElement;
	col: HTMLElement;
	plan: ItemPool<D>;
	actual: ItemPool<D>;
	bg: ItemPool<D>;
	actualLane: HTMLElement;
	more: HTMLElement;
	sel: HTMLElement;
	now: HTMLElement | null;
	cap: HTMLElement | null;
}

const BAR_GAP = 2;

/** Week, day and N-day views: an all-day row over a scrolling time grid. */
export class TimeGridView<D> implements View {
	readonly el: HTMLElement;
	private readonly scroller: HTMLElement;
	private readonly top: HTMLElement;
	private readonly headRow: HTMLElement;
	private readonly allDayRow: HTMLElement | null;
	private readonly allDayLayer: HTMLElement | null;
	private readonly allDaySel: HTMLElement | null;
	private readonly allDayMore: HTMLElement | null;
	private readonly allDayPool: ItemPool<D> | null;
	private readonly body: HTMLElement | null;
	private readonly gutter: HTMLElement | null;
	private readonly nowGutter: HTMLElement | null = null;
	private cols: Column<D>[] = [];
	private weights: number[] = [];
	private ppm = 1;
	private resizeObs: ResizeObserver | null = null;

	constructor(private readonly ctx: ViewContext<D>) {
		const { doc, opts } = ctx;
		const showGrid = opts.timeGrid;
		this.el = h(doc, "div", "tnc-tg", { role: "table", "aria-label": ctx.view.title });
		this.el.classList.toggle("tnc-tg--no-grid", !showGrid);
		this.scroller = h(doc, "div", "tnc-tg-scroll");
		this.top = h(doc, "div", "tnc-tg-top");
		this.headRow = h(doc, "div", "tnc-tg-head tnc-tg-cols", { role: "row" });
		this.top.append(this.headRow);
		if (opts.allDaySlot || !showGrid) {
			this.allDayRow = h(doc, "div", "tnc-tg-allday tnc-tg-cols", { role: "row" });
			const label = h(doc, "div", "tnc-gutter-label", { role: "rowheader" }, showGrid ? ctx.text.allDay : "");
			this.allDayLayer = h(doc, "div", "tnc-allday-layer", { role: "cell", "aria-colspan": String(ctx.days.length) });
			this.allDaySel = h(doc, "div", "tnc-sel-layer");
			this.allDayMore = h(doc, "div", "tnc-more-layer");
			this.allDayLayer.append(this.allDaySel, this.allDayMore);
			this.allDayRow.append(label, this.allDayLayer);
			this.allDayPool = new ItemPool(ctx, this.allDayLayer);
			this.top.append(this.allDayRow);
		} else {
			this.allDayRow = this.allDayLayer = this.allDaySel = this.allDayMore = null;
			this.allDayPool = null;
		}
		this.scroller.append(this.top);
		if (showGrid) {
			this.body = h(doc, "div", "tnc-tg-body tnc-tg-cols", { role: "row" });
			this.gutter = h(doc, "div", "tnc-gutter", { "aria-hidden": "true" });
			this.body.append(this.gutter);
			this.nowGutter = h(doc, "div", "tnc-now-label");
			this.scroller.append(this.body);
		} else {
			this.body = this.gutter = null;
		}
		this.el.append(this.scroller);
		this.build();
		if (showGrid && opts.height === "fill") {
			const RO = (ctx.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
			if (RO) {
				this.resizeObs = new RO(() => this.fitRows());
				this.resizeObs.observe(this.scroller);
			}
		}
	}

	private get minutes(): number {
		return this.ctx.slot.max - this.ctx.slot.min;
	}

	/* ------------------------------------------------------------ structure */

	private build(): void {
		const { ctx } = this;
		const { doc, opts, days, today } = ctx;
		this.weights = days.map((d) => (d === today && opts.todayWidth > 1 && days.length > 1 ? opts.todayWidth : 1));
		const tpl = `var(--tnc-gutter-w) ${this.weights.map((w) => `minmax(var(--tnc-col-min), ${w}fr)`).join(" ")}`;
		this.el.style.setProperty("--tnc-cols", tpl);
		this.el.style.setProperty("--tnc-ncols", String(days.length));

		// Header
		const gutterHead = h(doc, "div", "tnc-gutter-head", { role: "columnheader" });
		if (opts.weekNumbers && days[0] !== undefined) gutterHead.textContent = ctx.text.weekNumber(isoWeekNumber(days[0]));
		this.headRow.replaceChildren(gutterHead);
		const capacity = opts.capacityMinutes;
		this.cols = days.map((day) => {
			const arg = ctx.dayArg(day);
			const head = h(doc, "div", ["tnc-dh", ...ctx.dayClasses(day)].join(" "), {
				role: "columnheader",
				"data-date": arg.dateStr,
				"aria-label": ctx.fmt.longDate(day),
			});
			const custom = opts.dayHeaderContent?.(arg);
			if (custom != null) head.append(custom);
			else {
				const label = h(
					doc,
					"span",
					"tnc-dh-label",
					null,
					h(doc, "span", "tnc-dh-dow", null, ctx.fmt.weekdayShort(day)),
					h(doc, "span", "tnc-dh-num", null, ctx.fmt.dayNumber(day)),
				);
				head.append(opts.navLinks ? ctx.navLink(day, label, "tnc-dh-link") : label);
			}
			let cap: HTMLElement | null = null;
			if (capacity !== null) {
				cap = h(doc, "div", "tnc-cap", null, h(doc, "i"), h(doc, "span", "tnc-cap-txt"));
				head.append(cap);
			}
			this.headRow.append(head);
			opts.dayHeaderDidMount?.({ ...arg, el: head });

			const col = h(doc, "div", ["tnc-col", ...ctx.dayClasses(day)].join(" "), { role: "cell", "aria-label": ctx.fmt.longDate(day), "data-date": arg.dateStr });
			const bgLayer = h(doc, "div", "tnc-col-bg");
			const planLayer = h(doc, "div", "tnc-col-plan");
			const actualLane = h(doc, "div", "tnc-col-actual");
			const more = h(doc, "div", "tnc-more-layer");
			const sel = h(doc, "div", "tnc-sel-layer");
			col.append(bgLayer, sel, planLayer, actualLane, more);
			let now: HTMLElement | null = null;
			if (opts.nowIndicator && day === today) {
				now = h(doc, "div", "tnc-now", { "aria-hidden": "true" });
				col.append(now);
			}
			this.body?.append(col);
			return {
				day,
				head,
				col,
				plan: new ItemPool(ctx, planLayer),
				actual: new ItemPool(ctx, actualLane),
				bg: new ItemPool(ctx, bgLayer),
				actualLane,
				more,
				sel,
				now,
				cap,
			};
		});
		if (this.gutter) this.buildGutter();
		this.applyScale();
	}

	private buildGutter(): void {
		const { ctx } = this;
		const gutter = this.gutter!;
		gutter.replaceChildren();
		const { min, max, duration } = ctx.slot;
		const interval = duration >= 60 ? duration : 60;
		const first = Math.ceil(min / interval) * interval;
		for (let m = first; m < max; m += interval) {
			if (m === min) continue;
			const label = h(ctx.doc, "div", "tnc-slot-label", null, ctx.fmt.slotLabel(m));
			label.style.top = pct((m - min) / this.minutes);
			gutter.append(label);
		}
		if (this.nowGutter) gutter.append(this.nowGutter);
	}

	private applyScale(): void {
		const { opts, slot } = this.ctx;
		this.ppm = opts.slotHeight / slot.duration;
		this.fitRows(false);
		this.el.style.setProperty("--tnc-slot-px", `${slot.duration * this.ppm}px`);
		this.el.style.setProperty("--tnc-hour-px", `${60 * this.ppm}px`);
		this.el.style.setProperty("--tnc-grid-offset", `${-((slot.min % 60) * this.ppm)}px`);
		if (this.body) this.body.style.height = `${this.minutes * this.ppm}px`;
	}

	/** In fill mode with expandRows, stretches slots so the grid fills the height. */
	private fitRows(rerender = true): void {
		const { opts, slot } = this.ctx;
		if (!this.body || opts.height !== "fill" || !opts.expandRows) return;
		const avail = this.scroller.clientHeight - this.top.offsetHeight;
		const base = opts.slotHeight / slot.duration;
		const next = avail > 0 ? Math.max(base, avail / this.minutes) : base;
		if (Math.abs(next - this.ppm) < 0.001) return;
		this.ppm = next;
		this.body.style.height = `${this.minutes * this.ppm}px`;
		this.el.style.setProperty("--tnc-slot-px", `${slot.duration * this.ppm}px`);
		this.el.style.setProperty("--tnc-hour-px", `${60 * this.ppm}px`);
		if (rerender) this.render(null);
	}

	/* --------------------------------------------------------------- render */

	render(change: StoreChange | null): void {
		this.renderAllDay();
		if (!this.body) return;
		const dirty = change ? change.days : null;
		for (const c of this.cols) {
			if (dirty && !dirty.has(c.day) && !(this.ctx.slot.max > MINUTES_PER_DAY && dirty.has(c.day + 1))) continue;
			this.renderColumn(c);
		}
		this.renderCapacity();
		this.tick();
	}

	private renderCapacity(): void {
		const cap = this.ctx.opts.capacityMinutes;
		if (cap === null) return;
		const planned = plannedMinutes(this.ctx.store, this.cols.map((c) => c.day));
		for (const c of this.cols) {
			if (!c.cap) continue;
			const limit = typeof cap === "function" ? cap(c.day) : cap;
			const used = planned.get(c.day) ?? 0;
			const ratio = limit > 0 ? used / limit : 0;
			const bar = c.cap.firstElementChild as HTMLElement;
			bar.style.width = pct(Math.min(1, ratio));
			c.cap.classList.toggle("is-warn", ratio > 0.85 && ratio <= 1);
			c.cap.classList.toggle("is-over", ratio > 1);
			const hours = (m: number) => `${Math.round((m / 60) * 10) / 10}h`;
			(c.cap.lastElementChild as HTMLElement).textContent = limit > 0 ? `${hours(used)} / ${hours(limit)}` : hours(used);
		}
	}

	private renderAllDay(): void {
		const { ctx } = this;
		if (!this.allDayLayer || !this.allDayPool || !this.allDayMore) return;
		const { days, store, opts } = ctx;
		const first = days[0];
		const last = days[days.length - 1];
		if (first === undefined || last === undefined) return;
		// Without a time grid, timed items show in the all-day row too.
		const items = opts.timeGrid
			? store.spanningIn(first, last + 1, false)
			: store.inRange(first, last + 1).filter((n) => n.item.display !== "background");
		const row = layoutRow(items.filter((n) => n.item.display !== "background"), days, ctx.order);
		const limit = this.allDayLimit();
		const visibleLevels = (col: number) => (limit && (row.countByCol[col] ?? 0) > limit ? limit - 1 : limit || Infinity);
		const offsets = this.colOffsets();
		const pool = this.allDayPool;
		pool.begin();
		const hidden = new Array<number>(days.length).fill(0);
		let maxLevel = -1;
		for (const p of row.placements) {
			let level = p.level;
			let room = Infinity;
			for (let c = p.startCol; c < p.endCol; c++) room = Math.min(room, visibleLevels(c));
			if (level >= room) {
				// The item being dragged always shows, in the last row that has room, so the preview never hides behind "+N more".
				if (p.item.id !== ctx.draggingId) {
					for (let c = p.startCol; c < p.endCol; c++) hidden[c]!++;
					continue;
				}
				level = Math.max(0, room - 1);
			}
			maxLevel = Math.max(maxLevel, level);
			const el = pool.place(p.item.id, {
				n: p.item,
				day: days[p.startCol]!,
				isStart: p.isStart,
				isEnd: p.isEnd,
				variant: "bar",
				mirror: false,
			});
			setStyle(el, {
				left: `calc(${pct(offsets[p.startCol]!)} + 2px)`,
				width: `calc(${pct(offsets[p.endCol]! - offsets[p.startCol]!)} - 4px)`,
				top: `calc(${level} * (var(--tnc-bar-h) + ${BAR_GAP}px) + 3px)`,
			});
		}
		pool.end();
		this.allDayMore.replaceChildren();
		let anyMore = false;
		hidden.forEach((count, col) => {
			if (!count) return;
			anyMore = true;
			const day = days[col]!;
			const link = h(ctx.doc, "button", "tnc-more", { type: "button", "aria-haspopup": "dialog" }, ctx.text.more(count));
			setStyle(link, {
				left: `calc(${pct(offsets[col]!)} + 2px)`,
				width: `calc(${pct(offsets[col + 1]! - offsets[col]!)} - 4px)`,
				top: `calc(${visibleLevels(col)} * (var(--tnc-bar-h) + ${BAR_GAP}px) + 3px)`,
			});
			link.addEventListener("click", (ev) => ctx.openMore(day, link, ev));
			this.allDayMore!.append(link);
		});
		// Room for the bars, and for "+N more" links at their real height (hosts may make them taller).
		const bars = `calc(${Math.max(1, maxLevel + 1)} * (var(--tnc-bar-h) + ${BAR_GAP}px) + 6px)`;
		if (!anyMore) {
			this.allDayLayer.style.height = bars;
			return;
		}
		const moreH = this.allDayMore.querySelector<HTMLElement>(".tnc-more")?.offsetHeight ?? 0;
		const moreTop = Math.max(...hidden.map((count, col) => (count ? visibleLevels(col) : 0)));
		this.allDayLayer.style.height = `max(${bars}, calc(${moreTop} * (var(--tnc-bar-h) + ${BAR_GAP}px) + ${moreH}px + 6px))`;
	}

	private allDayLimit(): number {
		const { dayMaxEvents, dayMaxEventRows } = this.ctx.opts;
		if (dayMaxEventRows > 0) return dayMaxEventRows;
		if (typeof dayMaxEvents === "number" && dayMaxEvents > 0) return dayMaxEvents + 1;
		// "Auto" keeps the all-day row compact above a time grid; without one it may grow.
		if (dayMaxEvents === true && this.ctx.opts.timeGrid) return 4;
		return 0;
	}

	/** Fractional left edge of each column (length n + 1). */
	private colOffsets(): number[] {
		const total = this.weights.reduce((a, b) => a + b, 0) || 1;
		const out = [0];
		let acc = 0;
		for (const w of this.weights) out.push((acc += w) / total);
		return out;
	}

	private renderColumn(c: Column<D>): void {
		const { ctx } = this;
		const { store, opts, slot, zone } = ctx;
		const items: NormalizedItem<D>[] = store.timedOn(c.day);
		if (slot.max > MINUTES_PER_DAY) {
			const seen = new Set(items.map((n) => n.id));
			for (const n of store.timedOn(c.day + 1)) if (!seen.has(n.id)) items.push(n);
		}
		const minMinutes = opts.eventMinHeight / this.ppm;
		const layout = layoutTimedDay(items, c.day, zone, minMinutes, ctx.order, [slot.min, slot.max]);
		const total = this.minutes;
		const top = (m: number) => pct((m - slot.min) / total);
		const height = (s: TimedSegment<D>) => pct((s.endMin - s.startMin) / total);

		c.bg.begin();
		for (const s of layout.background) {
			const el = c.bg.place(s.item.id, this.meta(s, true));
			setStyle(el, { top: top(s.startMin), height: height(s) });
		}
		c.bg.end();

		const hasActual = layout.actual.length > 0;
		c.col.classList.toggle("has-actual", hasActual);
		this.placeLane(c.plan, layout.plan, c, top, height, true);
		this.placeLane(c.actual, layout.actual, c, top, height, false);
	}

	private placeLane(
		pool: ItemPool<D>,
		placements: TimedPlacement<D>[],
		c: Column<D>,
		top: (m: number) => string,
		height: (s: TimedSegment<D>) => string,
		withMore: boolean,
	): void {
		const { ctx } = this;
		const { opts } = ctx;
		const maxStack = opts.eventMaxStack;
		const hiddenByCluster = new Map<number, { count: number; start: number; end: number; items: TimedPlacement<D>[] }>();
		pool.begin();
		for (const p of placements) {
			if (withMore && maxStack > 0 && p.cols > maxStack && p.col >= maxStack - 1) {
				const rec = hiddenByCluster.get(p.cluster) ?? { count: 0, start: p.startMin, end: p.endMin, items: [] };
				rec.count++;
				rec.start = Math.min(rec.start, p.startMin);
				rec.end = Math.max(rec.end, p.endMin);
				rec.items.push(p);
				hiddenByCluster.set(p.cluster, rec);
				continue;
			}
			const cols = withMore && maxStack > 0 ? Math.min(p.cols, maxStack) : p.cols;
			const span = Math.min(p.span, cols - p.col);
			const left = p.col / cols;
			let width = span / cols;
			if (opts.slotEventOverlap && cols > 1 && p.col + span < cols) width = Math.min(1 - left, width * 1.7);
			const el = pool.place(p.item.id, this.meta(p, false));
			const short = (p.endMin - p.startMin) * this.ppm < 34;
			el.classList.toggle("is-short", short);
			setStyle(el, {
				top: top(p.startMin),
				height: `max(${height(p)}, ${opts.eventMinHeight}px)`,
				left: pct(left),
				width: `calc(${pct(width)} - 1px)`,
				"z-index": String(p.col + 1),
			});
		}
		pool.end();
		if (!withMore) return;
		c.more.replaceChildren();
		for (const rec of hiddenByCluster.values()) {
			const link = h(ctx.doc, "button", "tnc-more tnc-more--stack", { type: "button", "aria-haspopup": "dialog" }, `+${rec.count}`);
			const cols = maxStack;
			setStyle(link, {
				top: top(rec.start),
				left: pct((cols - 1) / cols),
				width: `calc(${pct(1 / cols)} - 1px)`,
			});
			link.addEventListener("click", (ev) => ctx.openMore(c.day, link, ev));
			c.more.append(link);
		}
	}

	private meta(s: TimedSegment<D>, bg: boolean) {
		return {
			n: s.item,
			day: s.day,
			isStart: s.isStart,
			isEnd: s.isEnd,
			variant: bg ? ("bar" as const) : ("timed" as const),
			mirror: false,
		};
	}

	/* ------------------------------------------------------------ selection */

	showSelection(sel: Selection | null): void {
		const { ctx } = this;
		const offsets = this.colOffsets();
		if (this.allDaySel) {
			this.allDaySel.replaceChildren();
			if (sel?.allDay) {
				const startCol = this.cols.findIndex((c) => c.day >= sel.startDay);
				let endCol = this.cols.findIndex((c) => c.day >= sel.endDay);
				if (endCol < 0) endCol = this.cols.length;
				if (startCol >= 0 && endCol > startCol) {
					const box = h(ctx.doc, "div", "tnc-sel");
					setStyle(box, {
						left: pct(offsets[startCol]!),
						width: pct(offsets[endCol]! - offsets[startCol]!),
						top: "0",
						bottom: "0",
					});
					this.allDaySel.append(box);
				}
			}
		}
		for (const c of this.cols) {
			c.sel.replaceChildren();
			if (!sel || sel.allDay) continue;
			const winStart = toInstant(c.day, ctx.slot.min, ctx.zone);
			const winEnd = toInstant(c.day, ctx.slot.max, ctx.zone);
			const s = Math.max(sel.startMs, winStart);
			const e = Math.min(sel.endMs, winEnd);
			if (e <= s) continue;
			const rel = (ms: number) => {
				const w = wallTime(ms, ctx.zone);
				return (w.day - c.day) * MINUTES_PER_DAY + w.minute;
			};
			const sm = s === winStart ? ctx.slot.min : rel(s);
			const em = e === winEnd ? ctx.slot.max : rel(e);
			const box = h(ctx.doc, "div", "tnc-sel");
			if (ctx.opts.selectMirror) {
				box.classList.add("tnc-sel--mirror");
				box.textContent = `${ctx.fmt.time(sm)} – ${ctx.fmt.time(em)}`;
			}
			setStyle(box, { top: pct((sm - ctx.slot.min) / this.minutes), height: pct((em - sm) / this.minutes) });
			c.sel.append(box);
		}
	}

	/* ------------------------------------------------------------- hit test */

	hit(x: number, y: number): Hit | null {
		const colIndex = (cells: HTMLElement[]) => {
			for (let i = 0; i < cells.length; i++) {
				const r = cells[i]!.getBoundingClientRect();
				if (x >= r.left && x < r.right) return i;
			}
			const firstR = cells[0]?.getBoundingClientRect();
			const lastR = cells[cells.length - 1]?.getBoundingClientRect();
			if (firstR && x < firstR.left) return 0;
			if (lastR && x >= lastR.right) return cells.length - 1;
			return -1;
		};
		if (this.allDayRow) {
			const r = this.allDayRow.getBoundingClientRect();
			if (y >= r.top && y < r.bottom || (!this.body && y >= r.top)) {
				const i = colIndex(this.cols.map((c) => c.head));
				return i >= 0 ? { kind: "allDay", day: this.cols[i]!.day } : null;
			}
		}
		if (!this.body) return null;
		const i = colIndex(this.cols.map((c) => c.col));
		if (i < 0) return null;
		const c = this.cols[i]!;
		const r = c.col.getBoundingClientRect();
		const scrollerR = this.scroller.getBoundingClientRect();
		const topR = this.top.getBoundingClientRect();
		// Above the time grid (but below the sticky header) counts as the top of the grid.
		if (y < Math.max(topR.bottom, scrollerR.top)) {
			if (y < topR.top) return null;
			return this.allDayRow ? { kind: "allDay", day: c.day } : null;
		}
		const ratio = Math.min(1, Math.max(0, (y - r.top) / r.height));
		return { kind: "time", day: c.day, minute: this.ctx.slot.min + ratio * this.minutes };
	}

	/* ----------------------------------------------------------------- misc */

	tick(): void {
		const { ctx } = this;
		const nowMs = ctx.now();
		const w = wallTime(nowMs, ctx.zone);
		for (const c of this.cols) {
			if (!c.now) continue;
			const minute = (w.day - c.day) * MINUTES_PER_DAY + w.minute;
			const visible = minute >= ctx.slot.min && minute <= ctx.slot.max;
			c.now.hidden = !visible;
			if (visible) c.now.style.top = pct((minute - ctx.slot.min) / this.minutes);
			if (this.nowGutter) {
				this.nowGutter.hidden = !visible;
				if (visible) this.nowGutter.style.top = pct((minute - ctx.slot.min) / this.minutes);
			}
		}
	}

	resize(): void {
		this.fitRows();
	}

	scrollToTime(minute: number): void {
		if (!this.body) return;
		const y = (minute - this.ctx.slot.min) * this.ppm;
		this.scroller.scrollTop = Math.max(0, y);
	}

	getScroll() {
		return { top: this.scroller.scrollTop, left: this.scroller.scrollLeft };
	}

	setScroll(s: { top: number; left: number }) {
		this.scroller.scrollTop = s.top;
		this.scroller.scrollLeft = s.left;
	}

	elementsFor(id: string): HTMLElement[] {
		const out = this.allDayPool?.elementsFor(id) ?? [];
		for (const c of this.cols) out.push(...c.plan.elementsFor(id), ...c.actual.elementsFor(id), ...c.bg.elementsFor(id));
		return out;
	}

	destroy(): void {
		this.resizeObs?.disconnect();
		this.allDayPool?.clear();
		for (const c of this.cols) {
			c.plan.clear();
			c.actual.clear();
			c.bg.clear();
		}
		this.el.remove();
	}
}

