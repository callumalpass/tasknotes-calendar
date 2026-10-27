import { addMonths, type Day, parseDay, startOfMonth, startOfWeek, ymdOfDay } from "../../core/date";
import type { ViewContext } from "../context";
import { h } from "../dom";

const SWIPE_PX = 40;

/**
 * The agenda's date strip: one week, or the whole month when expanded. Days
 * with items carry a dot; the day at the top of the list is marked. Picking a
 * day hands it to the list, and swipes step a week (or a month).
 */
export class DateStrip<D> {
	readonly el: HTMLElement;
	private readonly title: HTMLButtonElement;
	private readonly dows: HTMLElement;
	private readonly grid: HTMLElement;
	private readonly slot: HTMLElement;
	/** Day at the top of the list. */
	private focus: Day;
	/** First day of the week shown, or the month shown when expanded. */
	private shown: Day;
	private target: Day | null = null;
	private swipe: { id: number; x: number; y: number } | null = null;
	private swallowClick = false;
	expanded = false;

	constructor(
		private readonly ctx: ViewContext<D>,
		private readonly pick: (day: Day, ev: MouseEvent | KeyboardEvent) => void,
		focus: Day,
	) {
		const { doc, text } = ctx;
		this.focus = focus;
		this.shown = startOfWeek(focus, ctx.firstDay);
		this.el = h(doc, "div", "tnc-strip");
		const head = h(doc, "div", "tnc-strip-head");
		this.title = h(doc, "button", "tnc-strip-title", { type: "button", "aria-expanded": "false" });
		this.title.addEventListener("click", () => this.setExpanded(!this.expanded));
		const prev = h(doc, "button", "tnc-strip-nav tnc-strip-prev", { type: "button", "aria-label": text.prev, title: text.prev }, "‹");
		const next = h(doc, "button", "tnc-strip-nav tnc-strip-next", { type: "button", "aria-label": text.next, title: text.next }, "›");
		prev.addEventListener("click", () => this.step(-1));
		next.addEventListener("click", () => this.step(1));
		this.slot = h(doc, "div", "tnc-strip-slot", { "data-tnc-no-drag": "" });
		head.append(this.title, prev, next, this.slot);
		this.dows = h(doc, "div", "tnc-strip-dows", { "aria-hidden": "true" });
		this.grid = h(doc, "div", "tnc-strip-grid", { role: "group" });
		const handle = h(doc, "button", "tnc-strip-handle", { type: "button", tabindex: "-1", "aria-hidden": "true" });
		handle.addEventListener("click", () => this.setExpanded(!this.expanded));
		this.el.append(head, this.dows, this.grid, handle);
		this.grid.addEventListener("click", this.onClick);
		this.grid.addEventListener("keydown", this.onKeyDown);
		this.el.addEventListener("pointerdown", this.onPointerDown);
		this.el.addEventListener("pointerup", this.onPointerUp);
		this.el.addEventListener("pointercancel", this.onPointerCancel);
		this.el.addEventListener("click", this.onClickCapture, true);
		this.draw();
		ctx.opts.stripSlotDidMount?.({ el: this.slot });
	}

	/** The list scrolled: mark its top day and keep it in view. */
	setFocus(day: Day): void {
		if (day === this.focus) return;
		this.focus = day;
		if (!this.expanded) this.shown = startOfWeek(day, this.ctx.firstDay);
		else if (startOfMonth(day) !== this.shown) this.shown = startOfMonth(day);
		this.draw();
	}

	setExpanded(on: boolean): void {
		if (on === this.expanded) return;
		this.expanded = on;
		this.shown = on ? startOfMonth(this.focus) : startOfWeek(this.focus, this.ctx.firstDay);
		this.draw();
	}

	/** Highlights the day a dragged item would land on. */
	markTarget(day: Day | null): void {
		if (day === this.target) return;
		this.target = day;
		for (const cell of this.grid.querySelectorAll<HTMLElement>(".tnc-strip-day"))
			cell.classList.toggle("is-drop-target", day !== null && cell.dataset.date === this.ctx.dayArg(day).dateStr);
	}

	dayAt(el: Element): Day | null {
		const cell = el.closest<HTMLElement>(".tnc-strip-day");
		return cell && this.grid.contains(cell) ? parseDay(cell.dataset.date ?? "") : null;
	}

	private step(dir: 1 | -1): void {
		this.shown = this.expanded ? addMonths(this.shown, dir) : this.shown + 7 * dir;
		this.draw();
	}

	private days(): Day[] {
		if (!this.expanded) return Array.from({ length: 7 }, (_, i) => this.shown + i);
		const first = startOfWeek(this.shown, this.ctx.firstDay);
		const end = addMonths(this.shown, 1);
		const weeks = Math.ceil((end - first) / 7);
		return Array.from({ length: weeks * 7 }, (_, i) => first + i);
	}

	/** Redraws the cells; also called on every list render to refresh the dots. */
	draw(): void {
		const { ctx } = this;
		const { doc, fmt, store } = ctx;
		const days = this.days();
		const titleDay = this.expanded ? this.shown : days.includes(this.focus) ? this.focus : this.shown + 3;
		this.title.replaceChildren(fmt.monthYear(titleDay), h(doc, "span", "tnc-strip-caret", { "aria-hidden": "true" }));
		this.title.setAttribute("aria-expanded", String(this.expanded));
		this.el.classList.toggle("is-expanded", this.expanded);
		this.dows.replaceChildren(...days.slice(0, 7).map((d) => h(doc, "span", null, null, fmt.weekdayNarrow(d))));
		const focused = this.grid.contains(doc.activeElement) ? (doc.activeElement as HTMLElement).dataset.date : undefined;
		const month = ymdOfDay(this.shown).month;
		const tabDay = days.includes(this.focus) ? this.focus : days[0];
		const cells = days.map((d) => {
			const arg = ctx.dayArg(d);
			const count = store.inRange(d, d + 1).filter((n) => n.item.display !== "background" && n.item.display !== "none").length;
			const first = ymdOfDay(d).day === 1 && d !== days[0] && !this.expanded;
			const label = fmt.longDate(d);
			const cell = h(
				doc,
				"button",
				[
					"tnc-strip-day",
					...ctx.dayClasses(d),
					d === this.focus ? "is-focus" : "",
					count ? "has-items" : "",
					this.expanded && ymdOfDay(d).month !== month ? "is-other-month" : "",
					d === this.target ? "is-drop-target" : "",
				]
					.filter(Boolean)
					.join(" "),
				{
					type: "button",
					"data-date": arg.dateStr,
					"aria-label": count ? `${label}, ${ctx.text.itemCount(count)}` : label,
					"aria-pressed": String(d === this.focus),
					tabindex: d === tabDay ? "0" : "-1",
				},
			);
			if (first) cell.append(h(doc, "span", "tnc-strip-month", { "aria-hidden": "true" }, fmt.monthShort(d)));
			cell.append(h(doc, "span", "tnc-strip-num", null, fmt.dayNumber(d)), h(doc, "span", "tnc-strip-dot", { "aria-hidden": "true" }));
			return cell;
		});
		this.grid.replaceChildren(...cells);
		this.grid.setAttribute("aria-label", fmt.monthYear(titleDay));
		if (focused) this.grid.querySelector<HTMLElement>(`[data-date="${focused}"]`)?.focus({ preventScroll: true });
	}

	private readonly onClick = (ev: MouseEvent) => {
		const day = this.dayAt(ev.target as Element);
		if (day === null) return;
		if (this.expanded) this.setExpanded(false);
		this.pick(day, ev);
	};

	private readonly onKeyDown = (ev: KeyboardEvent) => {
		const day = this.dayAt(ev.target as Element);
		if (day === null) return;
		const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
		if (move === undefined) return;
		ev.preventDefault();
		const next = day + move;
		const days = this.days();
		if (next < days[0]! || next > days[days.length - 1]!) {
			this.shown = this.expanded ? startOfMonth(next) : startOfWeek(next, this.ctx.firstDay);
			this.draw();
		}
		const cell = this.grid.querySelector<HTMLElement>(`[data-date="${this.ctx.dayArg(next).dateStr}"]`);
		if (!cell) return;
		for (const c of this.grid.querySelectorAll("[tabindex='0']")) c.setAttribute("tabindex", "-1");
		cell.setAttribute("tabindex", "0");
		cell.focus();
	};

	private readonly onPointerDown = (ev: PointerEvent) => {
		if (ev.button !== 0 || this.ctx.draggingId) return;
		this.swipe = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
	};

	private readonly onPointerUp = (ev: PointerEvent) => {
		const s = this.swipe;
		this.swipe = null;
		if (!s || s.id !== ev.pointerId) return;
		const dx = ev.clientX - s.x;
		if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(ev.clientY - s.y)) return;
		this.swallowClick = true;
		this.step(dx < 0 ? 1 : -1);
	};

	private readonly onPointerCancel = () => {
		this.swipe = null;
	};

	/** A swipe that ends on a day is not a pick. */
	private readonly onClickCapture = (ev: MouseEvent) => {
		if (!this.swallowClick) return;
		this.swallowClick = false;
		ev.stopPropagation();
		ev.preventDefault();
	};

	destroy(): void {
		this.ctx.opts.stripSlotWillUnmount?.({ el: this.slot });
		this.el.remove();
	}
}
