import { addMonths, type Day, MINUTES_PER_DAY, startOfMonth, startOfWeek, startOfYear, ymdOfDay } from "../../core/date";
import { layoutLane } from "../../core/layout";
import { dependencyType, itemDependencies } from "../../core/plan";
import type { StoreChange } from "../../core/store";
import type { DependencyType, NormalizedItem } from "../../core/types";
import { toInstant, wallTime } from "../../core/zone";
import { ItemPool, type Selection, type View, type ViewContext } from "../context";
import { h, setStyle } from "../dom";
import {
	type Hit,
	type LinkArg,
	type LinkDragArg,
	type LinkEdge,
	TIMELINE_UNIT_DAYS,
	type TimelineArea,
	type TimelineOptions,
	type TimelineRow,
	type TimelineScale,
} from "../options";

const SVG = "http://www.w3.org/2000/svg";

/** Bars narrower than this hide their title instead of showing clipped letters. */
const COMPACT_PX = 28;
/** Bars narrower than this drop their resize handles so the whole bar moves. */
const NARROW_PX = 20;
/** Half the drawn width of a milestone diamond. */
const MILESTONE_R = 7;

interface RowRec<D> {
	row: TimelineRow;
	el: HTMLElement;
	label: HTMLElement;
	track: HTMLElement;
	pool: ItemPool<D> | null;
	top: number;
	height: number;
}

interface LinkTarget<D> {
	n: NormalizedItem<D>;
	el: HTMLElement;
	edge: LinkEdge;
	port: HTMLElement | null;
}

interface LinkSession<D> {
	from: NormalizedItem<D>;
	fromEdge: LinkEdge;
	path: SVGPathElement;
	x: number;
	y: number;
	pointerId: number;
	target: LinkTarget<D> | null;
	valid: boolean;
	reason: string | null;
	cleanup: () => void;
}

function sameRow(a: TimelineRow, b: TimelineRow): boolean {
	return a === b || (a.id === b.id && a.title === b.title && a.depth === b.depth && a.group === b.group && a.color === b.color && a.collapsed === b.collapsed);
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
	private readonly ticks: HTMLElement;
	private readonly rowsEl: HTMLElement;
	private readonly svg: SVGSVGElement;
	private readonly todayLine: HTMLElement;
	private readonly todayTag: HTMLElement | null;
	private readonly selLayer: HTMLElement;
	private rows: RowRec<D>[] = [];
	private readonly scale: TimelineScale;
	private readonly dayWidth: number;
	private readonly startDay: Day;
	private readonly endDay: Day;
	private readonly labelWidth: number;
	private readonly rowHeight: number;
	private link: LinkSession<D> | null = null;

	private get tl(): TimelineOptions<D> {
		return this.ctx.opts.timeline ?? { rows: [], rowOf: () => null };
	}

	constructor(private readonly ctx: ViewContext<D>) {
		const { doc } = ctx;
		const given = this.tl.scale ?? {};
		const unit = given.unit ?? "day";
		this.dayWidth = given.dayWidth ?? (given.unitWidth ?? 36) / TIMELINE_UNIT_DAYS[unit];
		this.scale = { snapMinutes: MINUTES_PER_DAY, ...given, unit, unitWidth: this.dayWidth * TIMELINE_UNIT_DAYS[unit] };
		this.startDay = ctx.view.range.startDay;
		this.endDay = ctx.view.range.endDay;
		this.labelWidth = this.tl.labelWidth ?? 240;
		this.rowHeight = this.tl.rowHeight ?? 32;

		this.el = h(doc, "div", "tnc-tl");
		this.el.style.setProperty("--tnc-tl-label-w", `${this.labelWidth}px`);
		this.el.style.setProperty("--tnc-tl-row-h", `${this.rowHeight}px`);
		this.el.style.setProperty("--tnc-tl-day-w", `${this.dayWidth}px`);
		this.scroller = h(doc, "div", "tnc-tl-scroll");
		this.canvas = h(doc, "div", "tnc-tl-canvas");
		this.canvas.style.width = `${this.labelWidth + this.trackWidth()}px`;
		this.head = h(doc, "div", "tnc-tl-head");
		this.ticks = h(doc, "div", "tnc-tl-ticks");
		this.rowsEl = h(doc, "div", "tnc-tl-rows", { role: "rowgroup" });
		this.svg = doc.createElementNS(SVG, "svg");
		this.svg.classList.add("tnc-tl-deps");
		this.svg.setAttribute("aria-hidden", "true");
		this.todayLine = h(doc, "div", "tnc-tl-today", { "aria-hidden": "true" });
		this.todayTag = this.tl.todayLabel ? h(doc, "div", "tnc-tl-today-label", { "aria-hidden": "true" }, this.tl.todayLabel) : null;
		this.selLayer = h(doc, "div", "tnc-tl-sel");
		this.canvas.append(this.head, this.rowsEl);
		this.scroller.append(this.canvas);
		this.el.append(this.scroller);
		this.buildHead();
		this.el.addEventListener("pointerdown", this.onLinkDown, true);
	}

	/* ------------------------------------------------------------- geometry */

	private trackWidth(): number {
		return (this.endDay - this.startDay) * this.dayWidth;
	}

	/** X offset (within the track) of an instant. */
	private x(ms: number): number {
		const w = wallTime(ms, this.ctx.zone);
		return (w.day - this.startDay + w.minute / MINUTES_PER_DAY) * this.dayWidth;
	}

	private xDay(day: number): number {
		return (day - this.startDay) * this.dayWidth;
	}

	/** Instant at a track x offset. */
	private msAt(x: number): number {
		const civil = this.startDay * MINUTES_PER_DAY + (x / this.dayWidth) * MINUTES_PER_DAY;
		const day = Math.floor(civil / MINUTES_PER_DAY);
		return toInstant(day, civil - day * MINUTES_PER_DAY, this.ctx.zone);
	}

	/** Viewport x (from the scroller's left edge) where the track starts showing, and its visible width. */
	private trackViewport(): { left: number; width: number } {
		return { left: this.labelWidth, width: Math.max(0, this.scroller.clientWidth - this.labelWidth) };
	}

	/** Instant under a viewport x, measured from the scroller's left edge. */
	instantAt(viewportX: number): number {
		return this.msAt(this.scroller.scrollLeft + viewportX - this.labelWidth);
	}

	/** Viewport x of an instant at the current scroll. */
	viewportXOf(ms: number): number {
		return this.labelWidth + this.x(ms) - this.scroller.scrollLeft;
	}

	/** Scrolls so `ms` sits at `viewportX`. */
	placeInstant(ms: number, viewportX: number, smooth = false): void {
		this.scrollLeftTo(this.labelWidth + this.x(ms) - viewportX, smooth);
	}

	scrollToInstant(ms: number, align: "start" | "center" | "end", smooth: boolean): void {
		const vp = this.trackViewport();
		const vx = vp.left + (align === "start" ? 0 : align === "end" ? vp.width : vp.width / 2);
		this.placeInstant(ms, vx, smooth);
	}

	/** Viewport x of the middle of the visible track. */
	viewportCentre(): number {
		const vp = this.trackViewport();
		return vp.left + vp.width / 2;
	}

	/** The scroller's left edge in client coordinates. */
	viewportLeft(): number {
		return this.scroller.getBoundingClientRect().left;
	}

	private scrollLeftTo(left: number, smooth: boolean): void {
		const max = Math.max(0, this.scroller.scrollWidth - this.scroller.clientWidth);
		const target = Math.max(0, Math.min(max || left, left));
		if (typeof this.scroller.scrollTo === "function") this.scroller.scrollTo({ left: target, behavior: smooth ? "smooth" : "auto" });
		else this.scroller.scrollLeft = target;
	}

	private buildHead(): void {
		const { doc, fmt, today } = this.ctx;
		const top = h(doc, "div", "tnc-tl-tier tnc-tl-tier--major");
		const bottom = h(doc, "div", "tnc-tl-tier tnc-tl-tier--minor");
		const corner = h(doc, "div", "tnc-tl-corner");
		const ticks = this.ticks;
		ticks.append(top, bottom);
		if (this.todayTag) ticks.append(this.todayTag);
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

	private mountRow(row: TimelineRow): RowRec<D> {
		const { ctx } = this;
		const { doc } = ctx;
		const el = h(doc, "div", `tnc-tl-row${row.group ? " is-group" : ""}`, { role: "row", "data-row": row.id });
		const label = h(doc, "div", "tnc-tl-label", { role: "rowheader" });
		label.style.paddingLeft = `${10 + (row.depth ?? 0) * 16}px`;
		if (row.color) label.style.setProperty("--tnc-c", row.color);
		const tl = this.tl;
		if (tl.rowLabelDidMount) tl.rowLabelDidMount({ row, el: label });
		else if (tl.rowContent) tl.rowContent(row, label);
		else label.append(h(doc, "span", "tnc-tl-label-text", null, row.title));
		if (tl.onRowClick) label.addEventListener("click", (ev) => this.tl.onRowClick?.(row, ev));
		const track = h(doc, "div", "tnc-tl-track");
		el.append(label, track);
		return { row, el, label, track, pool: row.group ? null : new ItemPool(ctx, track), top: 0, height: this.rowHeight };
	}

	private unmountRow(rec: RowRec<D>): void {
		rec.pool?.clear();
		this.tl.rowLabelWillUnmount?.({ row: rec.row, el: rec.label });
		rec.el.remove();
	}

	render(_change: StoreChange | null): void {
		const { ctx } = this;
		const { store } = ctx;
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
		for (const row of this.tl.rows) {
			let rec = old.get(row.id);
			if (rec && !sameRow(rec.row, row)) {
				this.unmountRow(rec);
				rec = undefined;
			}
			rec ??= this.mountRow(row);
			old.delete(row.id);
			const items = byRow.get(row.id) ?? [];
			const lane = layoutLane(items, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
			const levels = Math.max(1, lane.levels);
			rec.height = this.rowHeight * levels;
			rec.el.style.height = `${rec.height}px`;
			rec.top = y;
			y += rec.height;
			if (rec.pool) {
				rec.pool.begin();
				for (const bar of lane.bars) this.placeBar(rec.pool, bar.item, bar.level);
				rec.pool.end();
			}
			next.push(rec);
		}
		for (const rec of old.values()) this.unmountRow(rec);
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

	private placeBar(pool: ItemPool<D>, n: NormalizedItem<D>, level: number): void {
		const { ctx } = this;
		const milestone = n.item.kind === "milestone";
		const el = pool.place(n.id, { n, day: n.startDay, isStart: true, isEnd: true, variant: "timeline", mirror: false });
		const x0 = n.allDay ? this.xDay(n.startDay) : this.x(n.startMs);
		const x1 = n.allDay ? this.xDay(n.endDay) : this.x(n.endMs);
		el.classList.toggle("is-milestone", milestone);
		el.classList.toggle("is-conflict", ctx.conflicts.has(n.id));
		if (milestone) {
			const cx = n.allDay ? this.xDay(n.startDay) + this.dayWidth / 2 : x0;
			setStyle(el, { left: cx, width: null, top: level * this.rowHeight, "--tnc-grip": null });
			return;
		}
		const width = Math.max(4, x1 - x0);
		el.classList.toggle("is-compact", width < COMPACT_PX);
		el.classList.toggle("is-narrow", width < NARROW_PX);
		// Grips shrink on short bars so a middle strip always moves the bar.
		const grip = Math.min(8, Math.floor((width - 12) / 2));
		setStyle(el, { left: x0, width, top: level * this.rowHeight, "--tnc-grip": width < NARROW_PX ? null : `${grip}px` });
	}

	private rowOfItem(id: string): RowRec<D> | undefined {
		for (const r of this.rows) if (r.pool?.elementsFor(id).length) return r;
		return undefined;
	}

	/** Track x of a bar's start or finish edge. */
	private edgeX(el: HTMLElement, edge: LinkEdge): number {
		if (el.classList.contains("is-milestone")) return el.offsetLeft + (edge === "start" ? -MILESTONE_R : MILESTONE_R);
		return edge === "start" ? el.offsetLeft : el.offsetLeft + el.offsetWidth;
	}

	private drawDependencies(): void {
		const { ctx } = this;
		this.svg.replaceChildren();
		if (!this.tl.dependencies) return;
		this.svg.setAttribute("width", String(this.trackWidth()));
		this.svg.setAttribute("height", this.rowsEl.style.height.replace("px", "") || "0");
		this.svg.style.left = `${this.labelWidth}px`;
		for (const n of ctx.store.all()) {
			if (!n.item.dependsOn?.length) continue;
			const toRow = this.rowOfItem(n.id);
			const toEl = toRow?.pool?.elementsFor(n.id)[0];
			if (!toRow || !toEl) continue;
			for (const dep of itemDependencies(n.item)) {
				const fromRow = this.rowOfItem(dep.id);
				const fromEl = fromRow?.pool?.elementsFor(dep.id)[0];
				if (!fromRow || !fromEl) continue;
				const path = this.ctx.doc.createElementNS(SVG, "path");
				path.setAttribute(
					"d",
					dependencyPath(
						dep.type,
						this.edgeX(fromEl, dep.type[0] === "S" ? "start" : "finish"),
						fromRow.top + fromEl.offsetTop + fromEl.offsetHeight / 2,
						this.edgeX(toEl, dep.type[1] === "S" ? "start" : "finish"),
						toRow.top + toEl.offsetTop + toEl.offsetHeight / 2,
					),
				);
				path.setAttribute("marker-end", "url(#tnc-arrow)");
				path.dataset.from = dep.id;
				path.dataset.to = n.id;
				path.dataset.type = dep.type;
				if (ctx.conflicts.get(n.id)?.includes(dep.id)) path.classList.add("is-conflict");
				this.svg.append(path);
			}
		}
		const defs = this.ctx.doc.createElementNS(SVG, "defs");
		defs.innerHTML =
			'<marker id="tnc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker>';
		this.svg.prepend(defs);
	}

	/* ---------------------------------------------------------------- links */

	private linkTargetAt(clientX: number, clientY: number, from: NormalizedItem<D>): LinkTarget<D> | null {
		const under = this.ctx.doc.elementFromPoint(clientX, clientY);
		const el = under?.closest<HTMLElement>(".tnc-item--timeline");
		if (!el || !this.el.contains(el)) return null;
		const meta = this.ctx.meta.get(el);
		if (!meta || meta.mirror || meta.n.id === from.id) return null;
		const port = under?.closest<HTMLElement>(".tnc-port") ?? null;
		let edge: LinkEdge;
		if (port) edge = port.dataset.edge === "start" ? "start" : "finish";
		else if (el.classList.contains("is-milestone")) edge = "start";
		else {
			const r = el.getBoundingClientRect();
			edge = clientX < r.left + r.width / 2 ? "start" : "finish";
		}
		return { n: meta.n, el, edge, port };
	}

	/** Centre of a target edge's port, in track coordinates. */
	private targetPoint(t: LinkTarget<D>): { x: number; y: number } {
		const port = t.port ?? t.el.querySelector<HTMLElement>(`.tnc-port[data-edge="${t.edge}"]`);
		const rowsR = this.rowsEl.getBoundingClientRect();
		const r = (port ?? t.el).getBoundingClientRect();
		return { x: r.left + r.width / 2 - rowsR.left - this.labelWidth, y: r.top + r.height / 2 - rowsR.top };
	}

	private linkArg(from: NormalizedItem<D>, fromEdge: LinkEdge, t: LinkTarget<D>): LinkArg<D> {
		return { from: from.item, to: t.n.item, fromEdge, toEdge: t.edge, type: dependencyType(fromEdge, t.edge) };
	}

	private linkState(s: LinkSession<D>, phase: LinkDragArg<D>["phase"], linked = false): LinkDragArg<D> {
		const t = s.target;
		return {
			phase,
			from: s.from.item,
			fromEdge: s.fromEdge,
			to: t?.n.item ?? null,
			toEdge: t?.edge ?? null,
			type: t ? dependencyType(s.fromEdge, t.edge) : null,
			valid: s.valid,
			reason: s.reason,
			linked,
		};
	}

	private markTarget(t: LinkTarget<D> | null, on: boolean, invalid = false): void {
		if (!t) return;
		t.el.classList.toggle("is-link-target", on);
		t.el.classList.toggle("is-link-invalid", on && invalid);
		for (const p of t.el.querySelectorAll<HTMLElement>(".tnc-port")) {
			const hit = on && p.dataset.edge === t.edge;
			p.classList.toggle("is-target", hit);
			p.classList.toggle("is-invalid", hit && invalid);
		}
	}

	private readonly onLinkDown = (ev: PointerEvent) => {
		const port = (ev.target as Element).closest?.<HTMLElement>(".tnc-port");
		if (!port || !this.tl.onLink || ev.button !== 0 || this.link) return;
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
		path.setAttribute("d", `M${x},${y}`);
		this.svg.append(path);
		const doc = this.ctx.doc;
		const move = (e: PointerEvent) => {
			const s = this.link;
			if (!s || e.pointerId !== s.pointerId) return;
			e.preventDefault();
			const t = this.linkTargetAt(e.clientX, e.clientY, s.from);
			const r = this.rowsEl.getBoundingClientRect();
			const end = t ? this.targetPoint(t) : { x: e.clientX - r.left - this.labelWidth, y: e.clientY - r.top };
			s.path.setAttribute("d", `M${s.x},${s.y} L${end.x},${end.y}`);
			if (t?.n.id === s.target?.n.id && t?.edge === s.target?.edge) return;
			this.markTarget(s.target, false);
			s.target = t;
			s.valid = true;
			s.reason = null;
			if (t) {
				const verdict = this.tl.canLink?.(this.linkArg(s.from, s.fromEdge, t)) ?? true;
				s.valid = verdict === true;
				s.reason = typeof verdict === "string" ? verdict : null;
			}
			s.path.classList.toggle("is-invalid", !s.valid);
			this.markTarget(t, true, !s.valid);
			this.tl.onLinkDrag?.(this.linkState(s, "over"));
		};
		const finish = (e: PointerEvent | null) => {
			const s = this.link;
			if (!s) return;
			if (e) move(e);
			this.endLink(e !== null);
		};
		const up = (e: PointerEvent) => {
			if (this.link && e.pointerId === this.link.pointerId) finish(e);
		};
		const cancel = (e: PointerEvent) => {
			if (this.link && e.pointerId === this.link.pointerId) finish(null);
		};
		const key = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			finish(null);
		};
		doc.addEventListener("pointermove", move);
		doc.addEventListener("pointerup", up);
		doc.addEventListener("pointercancel", cancel);
		doc.addEventListener("keydown", key, true);
		this.link = {
			from: meta.n,
			fromEdge: port.dataset.edge === "start" ? "start" : "finish",
			path,
			x,
			y,
			pointerId: ev.pointerId,
			target: null,
			valid: true,
			reason: null,
			cleanup: () => {
				doc.removeEventListener("pointermove", move);
				doc.removeEventListener("pointerup", up);
				doc.removeEventListener("pointercancel", cancel);
				doc.removeEventListener("keydown", key, true);
			},
		};
		this.el.classList.add("is-linking");
		this.tl.onLinkDrag?.(this.linkState(this.link, "start"));
	};

	private endLink(commit: boolean): void {
		const s = this.link;
		if (!s) return;
		this.link = null;
		s.cleanup();
		s.path.remove();
		this.markTarget(s.target, false);
		this.el.classList.remove("is-linking");
		if (commit) this.ctx.suppressNextClick();
		else s.target = null;
		const linked = commit && !!s.target && s.valid;
		if (linked && s.target) this.tl.onLink?.(this.linkArg(s.from, s.fromEdge, s.target));
		this.tl.onLinkDrag?.(this.linkState(s, "end", linked));
	}

	/* ------------------------------------------------------------ selection */

	showSelection(sel: Selection | null): void {
		this.selLayer.replaceChildren();
		if (!sel) return;
		const row = sel.rowId ? this.rows.find((r) => r.row.id === sel.rowId) : undefined;
		if (sel.rowId && !row) return;
		const x0 = sel.allDay ? this.xDay(sel.startDay) : this.x(sel.startMs);
		const x1 = sel.allDay ? this.xDay(sel.endDay) : this.x(sel.endMs);
		const box = h(this.ctx.doc, "div", `tnc-sel${row ? "" : " is-column"}`);
		const height = row ? row.height : parseFloat(this.rowsEl.style.height) || 0;
		setStyle(box, { left: this.labelWidth + x0, width: Math.max(2, x1 - x0), top: row ? row.top : 0, height });
		this.selLayer.append(box);
	}

	/* ------------------------------------------------------------- hit test */

	hit(x: number, y: number): Hit | null {
		const vr = this.scroller.getBoundingClientRect();
		const right = vr.left + (this.scroller.clientWidth || vr.width);
		const bottom = vr.top + (this.scroller.clientHeight || vr.height);
		if (x < vr.left || x >= right || y < vr.top || y >= bottom) return null;
		const r = this.rowsEl.getBoundingClientRect();
		const px = x - r.left - this.labelWidth;
		const days = px / this.dayWidth;
		const day = this.startDay + Math.floor(days);
		const minute = (days - Math.floor(days)) * MINUTES_PER_DAY;
		const inLabel = x < vr.left + this.labelWidth;
		const inHead = y < this.head.getBoundingClientRect().bottom;
		const rel = y - r.top;
		const row = inHead ? undefined : this.rows.find((rec) => rel >= rec.top && rel < rec.top + rec.height);
		let area: TimelineArea;
		if (inLabel) area = "label";
		else if (inHead) area = px < this.trackWidth() ? "header" : "outside";
		else area = row && px >= 0 && px < this.trackWidth() ? "track" : "outside";
		return { kind: "timeline", rowId: row?.row.id ?? null, day, minute, area, overTrack: area === "track" && !!row && !row.row.group };
	}

	tick(): void {
		const x = this.x(this.ctx.now());
		const inRange = x >= 0 && x <= this.trackWidth();
		this.todayLine.hidden = !inRange;
		this.todayLine.style.left = `${this.labelWidth + x}px`;
		if (this.todayTag) {
			this.todayTag.hidden = !inRange;
			this.todayTag.style.left = `${x}px`;
		}
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
		this.endLink(false);
		this.el.removeEventListener("pointerdown", this.onLinkDown, true);
		for (const r of this.rows) this.unmountRow(r);
		this.rows = [];
		this.el.remove();
	}
}

/**
 * Arrow from a predecessor edge to a successor edge. Paths leave a start edge
 * to the left and a finish edge to the right, and enter a start edge from the
 * left and a finish edge from the right.
 */
function dependencyPath(type: DependencyType, x1: number, y1: number, x2: number, y2: number): string {
	const gap = 10;
	const out = type[0] === "S" ? -1 : 1;
	const side = type[1] === "S" ? -1 : 1;
	const xa = x1 + out * gap;
	const xb = x2 + side * gap;
	const xEnd = x2 + side * 2;
	if (out === side) {
		const xe = out < 0 ? Math.min(xa, xb) : Math.max(xa, xb);
		return `M${x1},${y1} H${xe} V${y2} H${xEnd}`;
	}
	if (out > 0 ? xa <= xb : xa >= xb) {
		const mid = (x1 + x2) / 2;
		return `M${x1},${y1} H${mid} V${y2} H${xEnd}`;
	}
	return `M${x1},${y1} H${xa} V${(y1 + y2) / 2} H${xb} V${y2} H${xEnd}`;
}
