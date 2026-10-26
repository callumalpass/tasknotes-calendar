import { addMonths, type Day, daysInMonth, startOfWeek, ymdOfDay } from "../../core/date";
import type { StoreChange } from "../../core/store";
import type { Selection, View, ViewContext } from "../context";
import { h } from "../dom";
import type { Hit } from "../options";

interface Cell {
	day: Day;
	el: HTMLElement;
	dots: HTMLElement;
}

/** Twelve compact months. Each day shows how busy it is; clicking opens it. */
export class YearView<D> implements View {
	readonly el: HTMLElement;
	private readonly scroller: HTMLElement;
	private cells: Cell[] = [];

	constructor(private readonly ctx: ViewContext<D>) {
		const { doc, fmt, opts } = ctx;
		this.el = h(doc, "div", "tnc-year");
		this.scroller = h(doc, "div", "tnc-year-scroll");
		const grid = h(doc, "div", "tnc-year-grid");
		let month = ctx.view.range.startDay;
		for (let i = 0; i < 12; i++) {
			const { year, month: m } = ymdOfDay(month);
			const box = h(doc, "section", "tnc-ym", { "aria-label": fmt.monthYear(month) });
			const title = opts.navLinks
				? h(doc, "button", "tnc-ym-title", { type: "button", "data-month": `${year}-${m}` }, fmt.monthLong(month))
				: h(doc, "div", "tnc-ym-title", null, fmt.monthLong(month));
			const first = month;
			if (opts.navLinks) title.addEventListener("click", (ev) => this.ctx.navigate(first, ev as MouseEvent, "month"));
			box.append(title);
			const days = h(doc, "div", "tnc-ym-days", { role: "group", "aria-label": fmt.monthYear(month) });
			const start = startOfWeek(month, ctx.firstDay);
			for (let d = start; d < start + 7; d++) days.append(h(doc, "div", "tnc-ym-dow", { "aria-hidden": "true" }, fmt.weekdayNarrow(d)));
			const len = daysInMonth(year, m);
			for (let d = start; d < month; d++) days.append(h(doc, "div", "tnc-ym-pad"));
			for (let d = month; d < month + len; d++) {
				const arg = ctx.dayArg(d);
				const cell = h(doc, "button", ["tnc-ym-day", ...ctx.dayClasses(d)].join(" "), {
					type: "button",
					"data-date": arg.dateStr,
					"aria-label": fmt.longDate(d),
				});
				const dots = h(doc, "span", "tnc-ym-dots", { "aria-hidden": "true" });
				cell.append(h(doc, "span", "tnc-ym-num", null, fmt.dayNumber(d)), dots);
				days.append(cell);
				this.cells.push({ day: d, el: cell, dots });
			}
			box.append(days);
			grid.append(box);
			month = addMonths(month, 1);
		}
		this.scroller.append(grid);
		this.el.append(this.scroller);
	}

	render(_change: StoreChange | null): void {
		const { store } = this.ctx;
		const doc = this.ctx.doc;
		for (const c of this.cells) {
			const items = store
				.inRange(c.day, c.day + 1)
				.filter((n) => n.item.display !== "background")
				.sort(this.ctx.order);
			c.el.dataset.count = String(items.length);
			c.el.classList.toggle("has-items", items.length > 0);
			c.el.style.setProperty("--tnc-heat", String(Math.min(1, items.length / 6)));
			c.dots.replaceChildren(
				...items.slice(0, 3).map((n) => {
					const dot = h(doc, "i");
					const color = n.item.color ?? n.item.borderColor ?? n.item.backgroundColor;
					if (color) dot.style.setProperty("--tnc-c", color);
					return dot;
				}),
			);
			const label = this.ctx.fmt.longDate(c.day);
			c.el.setAttribute("aria-label", items.length ? `${label}, ${this.ctx.text.itemCount(items.length)}` : label);
			c.el.title = items.length ? `${label}\n${items.slice(0, 8).map((n) => `• ${n.item.title}`).join("\n")}${items.length > 8 ? `\n${this.ctx.text.more(items.length - 8)}` : ""}` : label;
		}
	}

	showSelection(_sel: Selection | null): void {}

	hit(x: number, y: number): Hit | null {
		const el = this.ctx.doc.elementFromPoint(x, y)?.closest<HTMLElement>(".tnc-ym-day");
		const c = el ? this.cells.find((cell) => cell.el === el) : undefined;
		return c ? { kind: "day", day: c.day } : null;
	}

	dayAt(el: Element): Day | null {
		const btn = el.closest(".tnc-ym-day");
		return this.cells.find((c) => c.el === btn)?.day ?? null;
	}

	getScroll() {
		return { top: this.scroller.scrollTop, left: 0 };
	}

	setScroll(s: { top: number; left: number }) {
		this.scroller.scrollTop = s.top;
	}

	elementsFor(_id: string): HTMLElement[] {
		return [];
	}

	destroy(): void {
		this.el.remove();
	}
}
