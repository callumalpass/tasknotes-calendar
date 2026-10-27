import { type Day, parseDay } from "../../core/date";
import type { StoreChange } from "../../core/store";
import type { NormalizedItem } from "../../core/types";
import { ItemPool, type Selection, type View, type ViewContext } from "../context";
import { h } from "../dom";
import type { Hit } from "../options";
import { DateStrip } from "./strip";

/** How far below the screen the agenda loads more days. */
const LOAD_AHEAD = "0px 0px 600px 0px";

/**
 * N-day agenda: one section per day that has items. With `listAgenda`, every
 * day gets a section, a date strip follows the day at the top, and more days
 * load as the list nears its end.
 */
export class ListView<D> implements View {
	readonly el: HTMLElement;
	private readonly scroller: HTMLElement;
	private readonly body: HTMLElement;
	private pools = new Map<Day, ItemPool<D>>();
	private sections = new Map<Day, HTMLElement>();
	private readonly strip: DateStrip<D> | null = null;
	private readonly sentinel: HTMLElement | null = null;
	private readonly loader: IntersectionObserver | null = null;
	private readonly stripSize: ResizeObserver | null = null;
	private frame: number | null = null;
	/** A picked day stays marked until the list is scrolled by hand. */
	private pinned = false;

	constructor(private readonly ctx: ViewContext<D>) {
		const { doc, win, opts } = ctx;
		this.el = h(doc, "div", "tnc-list");
		this.scroller = h(doc, "div", "tnc-list-scroll");
		this.body = h(doc, "div", "tnc-list-body", { role: "list", "aria-label": ctx.view.title });
		this.scroller.append(this.body);
		this.el.append(this.scroller);
		if (!opts.listAgenda) return;
		this.el.classList.add("tnc-list--agenda");
		this.strip = new DateStrip(ctx, (day, ev) => this.pick(day, ev), ctx.view.range.startDay);
		this.el.prepend(this.strip.el);
		this.sentinel = h(doc, "div", "tnc-list-more", { "aria-hidden": "true" });
		this.scroller.append(this.sentinel);
		const globals = win as Window & { IntersectionObserver?: typeof IntersectionObserver; ResizeObserver?: typeof ResizeObserver };
		const IO = globals.IntersectionObserver;
		if (IO) {
			this.loader = new IO(
				(entries) => {
					if (entries.some((e) => e.isIntersecting)) ctx.extendList(ctx.view.range.endDay + Math.max(7, opts.listDayCount));
				},
				// Auto height scrolls the page, so watch the viewport; fixed height scrolls the list.
				{ root: opts.height === "auto" ? null : this.scroller, rootMargin: LOAD_AHEAD },
			);
		}
		const RO = globals.ResizeObserver;
		if (RO) {
			const strip = this.strip.el;
			this.stripSize = new RO(() => this.el.style.setProperty("--tnc-strip-h", `${strip.offsetHeight}px`));
			this.stripSize.observe(strip);
		}
		win.addEventListener("scroll", this.onScroll, { capture: true, passive: true });
		// A hand on the list, not the strip, folds the month away.
		this.scroller.addEventListener("wheel", this.fold, { passive: true });
		this.scroller.addEventListener("touchmove", this.fold, { passive: true });
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
		const agenda = !!this.strip;
		const keep = new Set<Day>();
		let prev: HTMLElement | null = null;
		for (const day of days) {
			const items = this.itemsOn(day);
			if (!items.length && !agenda) continue;
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
			section.classList.toggle("is-empty", !items.length);
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
		this.strip?.draw();
		// Observing again re-checks a sentinel that is still in reach after new days arrive.
		if (this.loader && this.sentinel) {
			this.loader.unobserve(this.sentinel);
			this.loader.observe(this.sentinel);
		}
	}

	/** A strip day: the host hears of it, and the list brings it to the top. */
	private pick(day: Day, ev: MouseEvent | KeyboardEvent): void {
		this.ctx.dateClick(day, ev);
		this.ctx.showListDay(day);
	}

	/** Brings a day's section to the top, under the strip. */
	scrollToDay(day: Day): void {
		const section = this.sections.get(day);
		if (!section) return;
		// The strip may have just folded; its new height sets where the day lands.
		if (this.strip) this.el.style.setProperty("--tnc-strip-h", `${this.strip.el.offsetHeight}px`);
		section.scrollIntoView({ block: "start" });
		this.strip?.setFocus(day);
		this.pinned = true;
	}

	private readonly fold = () => {
		this.pinned = false;
		if (this.strip?.expanded) this.strip.setExpanded(false);
	};

	private readonly onScroll = () => {
		if (this.frame !== null) return;
		this.frame = this.ctx.win.requestAnimationFrame(() => {
			this.frame = null;
			this.followTop();
		});
	};

	/** Marks the first day not hidden under the strip. */
	private followTop(): void {
		if (!this.strip || this.pinned) return;
		const edge = this.strip.el.getBoundingClientRect().bottom + 1;
		for (const day of this.ctx.days) {
			const section = this.sections.get(day);
			if (section && section.getBoundingClientRect().bottom > edge) {
				this.strip.setFocus(day);
				return;
			}
		}
	}

	showSelection(_sel: Selection | null): void {}

	hit(x: number, y: number): Hit | null {
		const el = this.ctx.doc.elementFromPoint(x, y);
		const stripDay = el && this.strip ? this.strip.dayAt(el) : null;
		this.strip?.markTarget(stripDay !== null && this.ctx.draggingId ? stripDay : null);
		if (stripDay !== null) return { kind: "day", day: stripDay };
		const section = el?.closest<HTMLElement>(".tnc-list-section");
		const day = section && this.body.contains(section) ? parseDay(section.dataset.date ?? "") : null;
		return day === null ? null : { kind: "day", day };
	}

	dragEnded(): void {
		this.strip?.markTarget(null);
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
		const { win } = this.ctx;
		win.removeEventListener("scroll", this.onScroll, { capture: true });
		if (this.frame !== null) win.cancelAnimationFrame(this.frame);
		this.loader?.disconnect();
		this.stripSize?.disconnect();
		this.strip?.destroy();
		for (const p of this.pools.values()) p.clear();
		this.el.remove();
	}
}
