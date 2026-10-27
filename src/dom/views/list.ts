import { type Day, parseDay } from "../../core/date";
import type { StoreChange } from "../../core/store";
import type { NormalizedItem } from "../../core/types";
import { ItemPool, type Selection, type View, type ViewContext } from "../context";
import { h } from "../dom";
import type { Hit } from "../options";

/** How far below the screen the agenda loads more days. */
const LOAD_AHEAD = "0px 0px 600px 0px";

/** The agenda's lead section: items pulled out of their days, with a slot for host controls. */
interface Lead<D> {
	section: HTMLElement;
	slot: HTMLElement;
	pool: ItemPool<D>;
}

/**
 * N-day agenda: one section per day that has items. With `listAgenda`, every
 * day gets a section, the calendar's date strip follows the day at the top,
 * and more days load as the list nears its end. A lead section above the
 * first day can collect items such as overdue work.
 */
export class ListView<D> implements View {
	readonly el: HTMLElement;
	private readonly scroller: HTMLElement;
	private readonly body: HTMLElement;
	private readonly agenda: boolean;
	private pools = new Map<Day, ItemPool<D>>();
	private sections = new Map<Day, HTMLElement>();
	private lead: Lead<D> | null = null;
	private readonly sentinel: HTMLElement | null = null;
	private readonly loader: IntersectionObserver | null = null;
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
		this.agenda = opts.listAgenda;
		if (!this.agenda) return;
		this.el.classList.add("tnc-list--agenda");
		this.sentinel = h(doc, "div", "tnc-list-more", { "aria-hidden": "true" });
		this.scroller.append(this.sentinel);
		const IO = (win as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
		if (IO) {
			this.loader = new IO(
				(entries) => {
					if (entries.some((e) => e.isIntersecting)) ctx.extendList(ctx.view.range.endDay + Math.max(7, opts.listDayCount));
				},
				// Auto height scrolls the page, so watch the viewport; fixed height scrolls the list.
				{ root: opts.height === "auto" ? null : this.scroller, rootMargin: LOAD_AHEAD },
			);
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
		const { ctx, agenda } = this;
		const { doc, days, opts } = ctx;
		const includes = agenda && opts.listLeadTitle !== null ? opts.listLeadIncludes : undefined;
		const leadItems: NormalizedItem<D>[] = [];
		const inLead = new Set<string>();
		const keep = new Set<Day>();
		let prev: HTMLElement | null = null;
		for (const day of days) {
			let items = this.itemsOn(day);
			if (includes) {
				items = items.filter((n) => {
					if (!includes(n.item)) return true;
					if (!inLead.has(n.id)) {
						inLead.add(n.id);
						leadItems.push(n);
					}
					return false;
				});
			}
			if (!items.length && !agenda) continue;
			keep.add(day);
			let section = this.sections.get(day);
			let pool = this.pools.get(day);
			if (!section || !pool) {
				const arg = ctx.dayArg(day);
				const heading = h(doc, "div", ["tnc-list-day", ...ctx.dayClasses(day)].join(" "), { "data-date": arg.dateStr });
				const custom = opts.dayHeaderContent?.(arg);
				const label = custom ?? ctx.fmt.longDate(day);
				heading.append(opts.navLinks ? ctx.navLink(day, label, "tnc-list-day-link") : label);
				const rows = h(doc, "div", "tnc-list-rows", { role: "group" });
				section = h(doc, "div", "tnc-list-section", { role: "listitem", "aria-label": ctx.fmt.longDate(day), "data-date": arg.dateStr }, heading, rows);
				if (agenda && opts.listAddText !== null) section.append(this.addRow(day));
				opts.dayHeaderDidMount?.({ ...arg, el: heading });
				pool = new ItemPool(ctx, rows);
				this.sections.set(day, section);
				this.pools.set(day, pool);
			}
			section.classList.toggle("is-empty", !items.length);
			this.fill(pool, items, () => day);
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
		this.renderLead(leadItems);
		let empty = this.body.querySelector<HTMLElement>(":scope > .tnc-list-empty");
		if (!keep.size && !leadItems.length) {
			if (!empty) {
				empty = h(doc, "div", "tnc-list-empty", { role: "listitem" }, ctx.text.noItems);
				this.body.append(empty);
			}
		} else empty?.remove();
		this.ctx.strip?.draw();
		// Observing again re-checks a sentinel that is still in reach after new days arrive.
		if (this.loader && this.sentinel) {
			this.loader.unobserve(this.sentinel);
			this.loader.observe(this.sentinel);
		}
	}

	/** Places items in a pool, keeping DOM order equal to item order. */
	private fill(pool: ItemPool<D>, items: NormalizedItem<D>[], dayFor: (n: NormalizedItem<D>) => Day): void {
		pool.begin();
		for (const n of items) {
			const d = dayFor(n);
			pool.place(n.id, { n, day: d, isStart: n.startDay === d, isEnd: n.endDay === d + 1, variant: "list", mirror: false });
		}
		pool.end();
		for (const n of items) {
			const el = pool.elementsFor(n.id)[0];
			if (el) pool.container.append(el);
		}
	}

	private renderLead(items: NormalizedItem<D>[]): void {
		const { ctx } = this;
		const { doc, opts } = ctx;
		if (!items.length || opts.listLeadTitle === null) {
			if (!this.lead) return;
			opts.listLeadWillUnmount?.({ el: this.lead.slot });
			this.lead.pool.clear();
			this.lead.section.remove();
			this.lead = null;
			return;
		}
		if (!this.lead) {
			const title = opts.listLeadTitle;
			const slot = h(doc, "div", "tnc-list-lead-slot", { "data-tnc-no-drag": "" });
			const heading = h(doc, "div", "tnc-list-day tnc-list-lead-head", null, h(doc, "span", "tnc-list-lead-title", null, title), slot);
			const rows = h(doc, "div", "tnc-list-rows", { role: "group" });
			const section = h(doc, "div", "tnc-list-section tnc-list-lead", { role: "listitem", "aria-label": title }, heading, rows);
			this.lead = { section, slot, pool: new ItemPool(ctx, rows) };
			opts.listLeadDidMount?.({ el: slot });
		}
		if (this.body.firstChild !== this.lead.section) this.body.prepend(this.lead.section);
		const first = ctx.days[0] ?? ctx.view.range.startDay;
		this.fill(this.lead.pool, items, (n) => Math.max(n.startDay, first));
	}

	private addRow(day: Day): HTMLElement {
		const { ctx } = this;
		const label = ctx.opts.listAddText ?? "";
		const btn = h(ctx.doc, "button", "tnc-list-add", { type: "button", "aria-label": `${label}, ${ctx.fmt.longDate(day)}` }, label);
		btn.addEventListener("click", (ev) => ctx.opts.onListAdd?.({ ...ctx.dayArg(day), jsEvent: ev }));
		return btn;
	}

	/** Brings a day's section to the top, under the strip; the first day brings the lead section too. */
	scrollToDay(day: Day): void {
		const section = day === this.ctx.days[0] && this.lead ? this.lead.section : this.sections.get(day);
		if (!section) return;
		// The strip may have just folded; its new height sets where the day lands.
		this.ctx.strip?.measure();
		section.scrollIntoView({ block: "start" });
		this.ctx.strip?.setFocus(day);
		this.pinned = true;
	}

	private readonly fold = () => {
		this.pinned = false;
		const strip = this.ctx.strip;
		if (strip?.expanded) strip.setExpanded(false);
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
		const strip = this.ctx.strip;
		if (!strip || this.pinned) return;
		const edge = strip.el.getBoundingClientRect().bottom + 1;
		for (const day of this.ctx.days) {
			const section = this.sections.get(day);
			if (section && section.getBoundingClientRect().bottom > edge) {
				strip.setFocus(day);
				return;
			}
		}
	}

	showSelection(_sel: Selection | null): void {}

	hit(x: number, y: number): Hit | null {
		const el = this.ctx.doc.elementFromPoint(x, y);
		const section = el?.closest<HTMLElement>(".tnc-list-section");
		if (!section || !this.body.contains(section)) return null;
		if (section === this.lead?.section) {
			// Lead items move from their own day.
			const item = el?.closest<HTMLElement>(".tnc-item");
			const meta = item ? this.ctx.meta.get(item) : undefined;
			return { kind: "day", day: meta?.day ?? this.ctx.days[0] ?? this.ctx.view.range.startDay };
		}
		const day = parseDay(section.dataset.date ?? "");
		return day === null ? null : { kind: "day", day };
	}

	getScroll() {
		return { top: this.scroller.scrollTop, left: 0 };
	}

	setScroll(s: { top: number; left: number }) {
		this.scroller.scrollTop = s.top;
	}

	elementsFor(id: string): HTMLElement[] {
		const pools = [...this.pools.values(), ...(this.lead ? [this.lead.pool] : [])];
		return pools.flatMap((p) => p.elementsFor(id));
	}

	destroy(): void {
		const { win, opts } = this.ctx;
		win.removeEventListener("scroll", this.onScroll, { capture: true });
		if (this.frame !== null) win.cancelAnimationFrame(this.frame);
		this.loader?.disconnect();
		if (this.lead) opts.listLeadWillUnmount?.({ el: this.lead.slot });
		this.lead?.pool.clear();
		for (const p of this.pools.values()) p.clear();
		this.el.remove();
	}
}
