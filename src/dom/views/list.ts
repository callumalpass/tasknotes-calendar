import type { Day } from "../../core/date";
import type { StoreChange } from "../../core/store";
import type { NormalizedItem } from "../../core/types";
import { ItemPool, type Selection, type View, type ViewContext } from "../context";
import { h } from "../dom";
import type { Hit } from "../options";

/** N-day agenda: one section per day that has items. */
export class ListView<D> implements View {
	readonly el: HTMLElement;
	private readonly scroller: HTMLElement;
	private readonly body: HTMLElement;
	private pools = new Map<Day, ItemPool<D>>();
	private sections = new Map<Day, HTMLElement>();

	constructor(private readonly ctx: ViewContext<D>) {
		this.el = h(ctx.doc, "div", "tnc-list");
		this.scroller = h(ctx.doc, "div", "tnc-list-scroll");
		this.body = h(ctx.doc, "div", "tnc-list-body", { role: "list", "aria-label": ctx.view.title });
		this.scroller.append(this.body);
		this.el.append(this.scroller);
	}

	private itemsOn(day: Day): NormalizedItem<D>[] {
		const { store, opts } = this.ctx;
		const out = store.spanningIn(day, day + 1, true);
		const seen = new Set(out.map((n) => n.id));
		for (const n of store.timedOn(day)) if (!seen.has(n.id)) out.push(n);
		return out
			.filter((n) => n.item.display !== "background" && n.item.display !== "none" && (opts.allDaySlot || !n.allDay))
			.sort((a, b) => Number(b.allDay) - Number(a.allDay) || this.ctx.order(a, b));
	}

	render(_change: StoreChange | null): void {
		const { ctx } = this;
		const { doc, days } = ctx;
		const keep = new Set<Day>();
		let prev: HTMLElement | null = null;
		for (const day of days) {
			const items = this.itemsOn(day);
			if (!items.length) continue;
			keep.add(day);
			let section = this.sections.get(day);
			let pool = this.pools.get(day);
			if (!section || !pool) {
				const arg = ctx.dayArg(day);
				const heading = h(doc, "div", ["tnc-list-day", ...ctx.dayClasses(day)].join(" "), { "data-date": arg.dateStr });
				const custom = ctx.opts.dayHeaderContent?.(arg);
				const label = custom ?? ctx.fmt.longDate(day);
				heading.append(ctx.opts.navLinks ? ctx.navLink(day, label, "tnc-list-day-link") : label);
				const rows = h(doc, "div", "tnc-list-rows", { role: "group" });
				section = h(doc, "div", "tnc-list-section", { role: "listitem", "aria-label": ctx.fmt.longDate(day), "data-date": arg.dateStr }, heading, rows);
				ctx.opts.dayHeaderDidMount?.({ ...arg, el: heading });
				pool = new ItemPool(ctx, rows);
				this.sections.set(day, section);
				this.pools.set(day, pool);
			}
			pool.begin();
			for (const n of items) {
				pool.place(n.id, {
					n,
					day,
					isStart: n.startDay === day,
					isEnd: n.endDay === day + 1,
					variant: "list",
					mirror: false,
				});
			}
			pool.end();
			// Keep DOM order equal to item order.
			const rows = pool.container;
			for (const n of items) {
				const el = pool.elementsFor(n.id)[0];
				if (el) rows.append(el);
			}
			if (prev ? prev.nextSibling !== section : this.body.firstChild !== section) {
				if (prev) prev.after(section);
				else this.body.prepend(section);
			}
			prev = section;
		}
		for (const [day, section] of this.sections) {
			if (keep.has(day)) continue;
			this.pools.get(day)?.clear();
			this.pools.delete(day);
			section.remove();
			this.sections.delete(day);
		}
		let empty = this.body.querySelector<HTMLElement>(":scope > .tnc-list-empty");
		if (!keep.size) {
			if (!empty) {
				empty = h(doc, "div", "tnc-list-empty", { role: "listitem" }, ctx.text.noItems);
				this.body.append(empty);
			}
		} else empty?.remove();
	}

	showSelection(_sel: Selection | null): void {}

	hit(_x: number, _y: number): Hit | null {
		return null;
	}

	getScroll() {
		return { top: this.scroller.scrollTop, left: 0 };
	}

	setScroll(s: { top: number; left: number }) {
		this.scroller.scrollTop = s.top;
	}

	elementsFor(id: string): HTMLElement[] {
		return [...this.pools.values()].flatMap((p) => p.elementsFor(id));
	}

	destroy(): void {
		for (const p of this.pools.values()) p.clear();
		this.el.remove();
	}
}

