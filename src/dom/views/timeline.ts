import { addMonths, type Day, MINUTES_PER_DAY, startOfMonth, startOfWeek, startOfYear, ymdOfDay } from "../../core/date";
import { layoutLane } from "../../core/layout";
import type { StoreChange } from "../../core/store";
import type { NormalizedItem } from "../../core/types";
import { wallTime } from "../../core/zone";
import { ItemPool, type Selection, type View, type ViewContext } from "../context";
import { h, setStyle } from "../dom";
import type { Hit, TimelineOptions, TimelineRow, TimelineScale } from "../options";

const UNIT_DAYS: Record<TimelineScale["unit"], number> = { hour: 1 / 24, day: 1, week: 7, month: 30.44, quarter: 91.31 };

const SVG = "http://www.w3.org/2000/svg";

interface RowRec<D> {
	row: TimelineRow;
	el: HTMLElement;
	track: HTMLElement;
	pool: ItemPool<D> | null;
	top: number;
	height: number;
}

/**
 * Gantt-style timeline: one row per `TimelineRow`, bars positioned on civil
 * days so DST never stretches a day.
 */
export class TimelineView<D> implements View {
	readonly el: HTMLElement;
	private readonly scroller: HTMLElement;
	private readonly canvas: HTMLElement;
	private readonly head: HTMLElement;
	private readonly rowsEl: HTMLElement;
	private readonly svg: SVGSVGElement;
	private readonly todayLine: HTMLElement;
	private readonly selLayer: HTMLElement;
	private rows: RowRec<D>[] = [];
	private readonly scale: TimelineScale;
	private readonly dayWidth: number;
	private readonly startDay: Day;
	private readonly endDay: Day;
	private readonly labelWidth: number;
	private readonly rowHeight: number;
	private link: { from: NormalizedItem<D>; path: SVGPathElement; x: number; y: number } | null = null;

	private get tl(): TimelineOptions<D> {
		return this.ctx.opts.timeline ?? { rows: [], rowOf: () => null };
	}

	constructor(private readonly ctx: ViewContext<D>) {
		const { doc } = ctx;
		this.scale = { unit: "day", unitWidth: 36, snapMinutes: MINUTES_PER_DAY, ...this.tl.scale };
		this.dayWidth = this.scale.unitWidth / UNIT_DAYS[this.scale.unit];
		this.startDay = ctx.view.range.startDay;
		this.endDay = ctx.view.range.endDay;
		this.labelWidth = this.tl.labelWidth ?? 240;
		this.rowHeight = this.tl.rowHeight ?? 32;

		this.el = h(doc, "div", "tnc-tl");
		this.el.style.setProperty("--tnc-tl-label-w", `${this.labelWidth}px`);
		this.el.style.setProperty("--tnc-tl-row-h", `${this.rowHeight}px`);
		this.el.style.setProperty("--tnc-tl-day-w", `${this.dayWidth}px`);
		this.scroller = h(doc, "div", "tnc-tl-scroll");
		const width = (this.endDay - this.startDay) * this.dayWidth;
		this.canvas = h(doc, "div", "tnc-tl-canvas");
		this.canvas.style.width = `${this.labelWidth + width}px`;
		this.head = h(doc, "div", "tnc-tl-head");
		this.rowsEl = h(doc, "div", "tnc-tl-rows", { role: "rowgroup" });
		this.svg = doc.createElementNS(SVG, "svg");
		this.svg.classList.add("tnc-tl-deps");
		this.svg.setAttribute("aria-hidden", "true");
		this.todayLine = h(doc, "div", "tnc-tl-today", { "aria-hidden": "true" });
		this.selLayer = h(doc, "div", "tnc-tl-sel");
		this.canvas.append(this.head, this.rowsEl);
		this.scroller.append(this.canvas);
		this.el.append(this.scroller);
		this.buildHead();
		this.el.addEventListener("pointerdown", this.onLinkDown, true);
	}

	/* ------------------------------------------------------------- geometry */

	/** X offset (within the track) of an instant. */
	private x(ms: number): number {
		const w = wallTime(ms, this.ctx.zone);
		return (w.day - this.startDay + w.minute / MINUTES_PER_DAY) * this.dayWidth;
	}

	private xDay(day: number): number {
		return (day - this.startDay) * this.dayWidth;
	}

	private buildHead(): void {
		const { doc, fmt, today } = this.ctx;
		const top = h(doc, "div", "tnc-tl-tier tnc-tl-tier--major");
		const bottom = h(doc, "div", "tnc-tl-tier tnc-tl-tier--minor");
		const corner = h(doc, "div", "tnc-tl-corner");
		const ticks = h(doc, "div", "tnc-tl-ticks");
		ticks.append(top, bottom);
		this.head.append(corner, ticks);
		const unit = this.scale.unit;
		const add = (tier: HTMLElement, x0: number, x1: number, label: string, cls = "") => {
			const t = h(doc, "div", `tnc-tl-tick ${cls}`, null, h(doc, "span", null, null, label));
			setStyle(t, { left: x0, width: Math.max(0, x1 - x0) });
			tier.append(t);
		};
		const s = this.startDay;
		const e = this.endDay;
		// Major tier
		if (unit === "hour") {
			for (let d = s; d < e; d++) add(top, this.xDay(d), this.xDay(d + 1), fmt.longDate(d), d === today ? "is-today" : "");
		} else if (unit === "month" || unit === "quarter") {
			for (let d = startOfYear(s); d < e; d = startOfYear(addMonths(d, 12))) {
				add(top, this.xDay(Math.max(d, s)), this.xDay(Math.min(startOfYear(addMonths(d, 12)), e)), fmt.year(d));
			}
		} else {
			for (let d = startOfMonth(s); d < e; d = addMonths(d, 1)) {
				add(top, this.xDay(Math.max(d, s)), this.xDay(Math.min(addMonths(d, 1), e)), fmt.monthYear(d));
			}
		}
		// Minor tier
		if (unit === "hour") {
			const step = this.scale.unitWidth >= 28 ? 1 : this.scale.unitWidth >= 14 ? 2 : 6;
			for (let d = s; d < e; d++) {
				for (let hr = 0; hr < 24; hr += step) {
					const x0 = this.xDay(d) + (hr / 24) * this.dayWidth;
					add(bottom, x0, x0 + (step / 24) * this.dayWidth, fmt.slotLabel(hr * 60));
				}
			}
		} else if (unit === "day") {
			for (let d = s; d < e; d++) {
				const narrow = this.dayWidth < 26;
				add(bottom, this.xDay(d), this.xDay(d + 1), narrow ? fmt.dayNumber(d) : `${fmt.weekdayNarrow(d)} ${fmt.dayNumber(d)}`, [
					d === today ? "is-today" : "",
					...this.ctx.dayClasses(d).filter((c) => c === "is-weekend"),
				].join(" "));
			}
		} else if (unit === "week") {
			for (let d = startOfWeek(s, this.ctx.firstDay); d < e; d += 7) {
				add(bottom, this.xDay(Math.max(d, s)), this.xDay(Math.min(d + 7, e)), `${fmt.monthShort(d)} ${fmt.dayNumber(d)}`);
			}
		} else {
			const step = unit === "quarter" ? 3 : 1;
			for (let d = startOfMonth(s); d < e; d = addMonths(d, step)) {
				const label = unit === "quarter" ? `Q${Math.floor((ymdOfDay(d).month - 1) / 3) + 1}` : fmt.monthShort(d);
				add(bottom, this.xDay(Math.max(d, s)), this.xDay(Math.min(addMonths(d, step), e)), label);
			}
		}
		// Grid lines on rows use a repeating background sized to a "column".
		const colPx = unit === "hour" ? this.dayWidth / 24 : unit === "day" ? this.dayWidth : this.dayWidth * 7;
		this.el.style.setProperty("--tnc-tl-col-w", `${colPx}px`);
		this.el.style.setProperty("--tnc-tl-day-px", `${this.dayWidth}px`);
	}

	/* --------------------------------------------------------------- render */

	render(_change: StoreChange | null): void {
		const { ctx } = this;
		const { doc, store } = ctx;
		const byRow = new Map<string, NormalizedItem<D>[]>();
		for (const n of store.inRange(this.startDay, this.endDay)) {
			if (n.item.display === "none") continue;
			const rowId = ctx.dragRow?.id === n.id ? ctx.dragRow.rowId : this.tl.rowOf(n.item);
			if (rowId == null) continue;
			const list = byRow.get(rowId) ?? [];
			list.push(n);
			byRow.set(rowId, list);
		}
		const old = new Map(this.rows.map((r) => [r.row.id, r]));
		const next: RowRec<D>[] = [];
		let y = 0;
		const windowStart = Number.NEGATIVE_INFINITY;
		const windowEnd = Number.POSITIVE_INFINITY;
		for (const row of this.tl.rows) {
			let rec = old.get(row.id);
			if (!rec || rec.row !== row) {
				rec?.pool?.clear();
				rec?.el.remove();
				const el = h(doc, "div", `tnc-tl-row${row.group ? " is-group" : ""}`, { role: "row", "data-row": row.id });
				const label = h(doc, "div", "tnc-tl-label", { role: "rowheader" });
				label.style.paddingLeft = `${10 + (row.depth ?? 0) * 16}px`;
				if (row.color) label.style.setProperty("--tnc-c", row.color);
				if (this.tl.rowContent) this.tl.rowContent(row, label);
				else label.append(h(doc, "span", "tnc-tl-label-text", null, row.title));
				if (this.tl.onRowClick) label.addEventListener("click", (ev) => this.tl.onRowClick?.(row, ev));
				const track = h(doc, "div", "tnc-tl-track");
				el.append(label, track);
				rec = { row, el, track, pool: row.group ? null : new ItemPool(ctx, track), top: 0, height: this.rowHeight };
			}
			old.delete(row.id);
			const items = byRow.get(row.id) ?? [];
			const lane = layoutLane(items, windowStart, windowEnd);
			const levels = Math.max(1, lane.levels);
			rec.height = this.rowHeight * levels;
			rec.el.style.height = `${rec.height}px`;
			rec.top = y;
			y += rec.height;
			if (rec.pool) {
				rec.pool.begin();
				for (const bar of lane.bars) {
					const n = bar.item;
					const milestone = n.item.kind === "milestone";
					const el = rec.pool.place(n.id, { n, day: n.startDay, isStart: true, isEnd: true, variant: "timeline", mirror: false });
					const x0 = n.allDay ? this.xDay(n.startDay) : this.x(n.startMs);
					const x1 = n.allDay ? this.xDay(n.endDay) : this.x(n.endMs);
					el.classList.toggle("is-milestone", milestone);
					el.classList.toggle("is-conflict", ctx.conflicts.has(n.id));
					if (milestone) {
						const cx = n.allDay ? this.xDay(n.startDay) + this.dayWidth / 2 : x0;
						setStyle(el, { left: cx, width: null, top: bar.level * this.rowHeight });
					} else {
						setStyle(el, { left: x0, width: Math.max(4, x1 - x0), top: bar.level * this.rowHeight });
					}
				}
				rec.pool.end();
			}
			next.push(rec);
		}
		for (const rec of old.values()) {
			rec.pool?.clear();
			rec.el.remove();
		}
		// Keep DOM order equal to row order.
		let prev: HTMLElement | null = null;
		for (const rec of next) {
			if (prev ? prev.nextSibling !== rec.el : this.rowsEl.firstChild !== rec.el) {
				if (prev) prev.after(rec.el);
				else this.rowsEl.prepend(rec.el);
			}
			prev = rec.el;
		}
		this.rows = next;
		this.rowsEl.style.height = `${y}px`;
		this.rowsEl.append(this.svg, this.selLayer, this.todayLine);
		this.drawDependencies();
		this.tick();
	}

	private rowOfItem(id: string): RowRec<D> | undefined {
		for (const r of this.rows) if (r.pool?.elementsFor(id).length) return r;
		return undefined;
	}

	private drawDependencies(): void {
		const { ctx } = this;
		this.svg.replaceChildren();
		if (!this.tl.dependencies) return;
		const width = (this.endDay - this.startDay) * this.dayWidth;
		this.svg.setAttribute("width", String(width));
		this.svg.setAttribute("height", this.rowsEl.style.height.replace("px", "") || "0");
		this.svg.style.left = `${this.labelWidth}px`;
		for (const n of ctx.store.all()) {
			const deps = n.item.dependsOn;
			if (!deps?.length) continue;
			const toRow = this.rowOfItem(n.id);
			const toEl = toRow?.pool?.elementsFor(n.id)[0];
			if (!toRow || !toEl) continue;
			for (const dep of deps) {
				const fromRow = this.rowOfItem(dep);
				const fromEl = fromRow?.pool?.elementsFor(dep)[0];
				if (!fromRow || !fromEl) continue;
				const x1 = fromEl.offsetLeft + fromEl.offsetWidth;
				const y1 = fromRow.top + fromEl.offsetTop + fromEl.offsetHeight / 2;
				const x2 = toEl.offsetLeft;
				const y2 = toRow.top + toEl.offsetTop + toEl.offsetHeight / 2;
				const path = this.ctx.doc.createElementNS(SVG, "path");
				const mid = x2 - 10 > x1 + 10 ? (x1 + x2) / 2 : null;
				const d =
					mid !== null
						? `M${x1},${y1} H${mid} V${y2} H${x2 - 2}`
						: `M${x1},${y1} h10 V${(y1 + y2) / 2} H${x2 - 12} V${y2} H${x2 - 2}`;
				path.setAttribute("d", d);
				path.setAttribute("marker-end", "url(#tnc-arrow)");
				path.dataset.from = dep;
				path.dataset.to = n.id;
				if (ctx.conflicts.get(n.id)?.includes(dep)) path.classList.add("is-conflict");
				this.svg.append(path);
			}
		}
		const defs = this.ctx.doc.createElementNS(SVG, "defs");
		defs.innerHTML =
			'<marker id="tnc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker>';
		this.svg.prepend(defs);
	}

	/* ---------------------------------------------------------------- links */

	private readonly onLinkDown = (ev: PointerEvent) => {
		const port = (ev.target as Element).closest?.(".tnc-port");
		if (!port || !this.tl.onLink || ev.button !== 0) return;
		const barEl = port.closest<HTMLElement>(".tnc-item");
		const meta = barEl ? this.ctx.meta.get(barEl) : undefined;
		if (!meta) return;
		ev.stopPropagation();
		ev.preventDefault();
		const rowsR = this.rowsEl.getBoundingClientRect();
		const pr = port.getBoundingClientRect();
		const x = pr.left + pr.width / 2 - rowsR.left - this.labelWidth;
		const y = pr.top + pr.height / 2 - rowsR.top;
		const path = this.ctx.doc.createElementNS(SVG, "path");
		path.classList.add("is-linking");
		this.svg.append(path);
		this.link = { from: meta.n, path, x, y };
		const doc = this.ctx.doc;
		const move = (e: PointerEvent) => {
			if (!this.link) return;
			const r = this.rowsEl.getBoundingClientRect();
			this.link.path.setAttribute("d", `M${this.link.x},${this.link.y} L${e.clientX - r.left - this.labelWidth},${e.clientY - r.top}`);
		};
		const up = (e: PointerEvent) => {
			doc.removeEventListener("pointermove", move);
			doc.removeEventListener("pointerup", up);
			doc.removeEventListener("pointercancel", up);
			const link = this.link;
			this.link = null;
			link?.path.remove();
			if (!link || e.type === "pointercancel") return;
			const target = doc.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".tnc-tl .tnc-item");
			const to = target ? this.ctx.meta.get(target) : undefined;
			if (to && to.n.id !== link.from.id) this.tl.onLink?.({ from: link.from.item, to: to.n.item });
		};
		doc.addEventListener("pointermove", move);
		doc.addEventListener("pointerup", up);
		doc.addEventListener("pointercancel", up);
	};

	/* ------------------------------------------------------------ selection */

	showSelection(sel: Selection | null): void {
		this.selLayer.replaceChildren();
		if (!sel?.rowId) return;
		const row = this.rows.find((r) => r.row.id === sel.rowId);
		if (!row) return;
		const x0 = sel.allDay ? this.xDay(sel.startDay) : this.x(sel.startMs);
		const x1 = sel.allDay ? this.xDay(sel.endDay) : this.x(sel.endMs);
		const box = h(this.ctx.doc, "div", "tnc-sel");
		setStyle(box, { left: this.labelWidth + x0, width: Math.max(2, x1 - x0), top: row.top, height: row.height });
		this.selLayer.append(box);
	}

	/* ------------------------------------------------------------- hit test */

	hit(x: number, y: number): Hit | null {
		const r = this.rowsEl.getBoundingClientRect();
		const rel = y - r.top;
		const row = this.rows.find((rec) => rel >= rec.top && rel < rec.top + rec.height) ??
			(rel < 0 ? this.rows[0] : rel >= 0 ? this.rows[this.rows.length - 1] : undefined);
		if (!row || row.row.group) return null;
		const px = x - r.left - this.labelWidth;
		const days = px / this.dayWidth;
		const day = this.startDay + Math.floor(days);
		const minute = (days - Math.floor(days)) * MINUTES_PER_DAY;
		return { kind: "timeline", rowId: row.row.id, day, minute };
	}

	tick(): void {
		const nowMs = this.ctx.now();
		const x = this.x(nowMs);
		const inRange = x >= 0 && x <= (this.endDay - this.startDay) * this.dayWidth;
		this.todayLine.hidden = !inRange;
		this.todayLine.style.left = `${this.labelWidth + x}px`;
	}

	/** Scrolls so `day` sits a little in from the left edge. */
	scrollToDay(day: Day): void {
		this.scroller.scrollLeft = Math.max(0, this.xDay(day) - this.dayWidth * 2);
	}

	getScroll() {
		return { top: this.scroller.scrollTop, left: this.scroller.scrollLeft };
	}

	setScroll(s: { top: number; left: number }) {
		this.scroller.scrollTop = s.top;
		this.scroller.scrollLeft = s.left;
	}

	elementsFor(id: string): HTMLElement[] {
		return this.rows.flatMap((r) => r.pool?.elementsFor(id) ?? []);
	}

	destroy(): void {
		this.el.removeEventListener("pointerdown", this.onLinkDown, true);
		for (const r of this.rows) r.pool?.clear();
		this.el.remove();
	}
}
