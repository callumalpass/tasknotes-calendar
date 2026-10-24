import type { Day } from "../core/date";
import type { ItemOrder } from "../core/layout";
import type { ItemStore, StoreChange } from "../core/store";
import type { NormalizedItem } from "../core/types";
import type { TimeZone } from "../core/zone";
import type { Formatter } from "./format";
import type { CalendarOptions, CalendarText, DayArg, Hit, ItemVariant, ViewInfo } from "./options";

export type Variant = ItemVariant;

export interface ElMeta<D = unknown> {
	n: NormalizedItem<D>;
	day: Day;
	isStart: boolean;
	isEnd: boolean;
	variant: Variant;
	mirror: boolean;
}

/** A time or day range being selected, or previewed for an external drop. */
export interface Selection {
	startMs: number;
	endMs: number;
	allDay: boolean;
	startDay: Day;
	endDay: Day;
	rowId?: string;
}

/** What views get from the calendar. */
export interface ViewContext<D = unknown> {
	readonly doc: Document;
	readonly win: Window;
	readonly store: ItemStore<D>;
	readonly opts: CalendarOptions<D>;
	readonly zone: TimeZone;
	readonly fmt: Formatter;
	readonly text: CalendarText;
	readonly order: ItemOrder<D>;
	readonly view: ViewInfo;
	readonly firstDay: number;
	/** Visible days in order (hidden weekdays removed). */
	readonly days: Day[];
	readonly today: Day;
	readonly conflicts: ReadonlyMap<string, string[]>;
	readonly slot: { min: number; max: number; duration: number; snap: number; scroll: number };
	/** Item currently being dragged, if any. */
	readonly draggingId: string | null;
	now(): number;
	meta: WeakMap<Element, ElMeta<D>>;
	dayArg(day: Day): DayArg;
	dayClasses(day: Day): string[];
	isEditable(n: NormalizedItem<D>, what: "start" | "duration"): boolean;
	/** Renders the element for an item (no position). */
	createItemEl(meta: ElMeta<D>): HTMLElement;
	/** Refreshes parts of an item element that depend on position (time label). */
	refreshItemEl(el: HTMLElement, meta: ElMeta<D>): void;
	destroyItemEl(el: HTMLElement): void;
	/** Builds a nav link (day number / header) for a day. */
	navLink(day: Day, label: Node | string, cls: string): HTMLElement;
	openMore(day: Day, anchor: HTMLElement, jsEvent: MouseEvent | KeyboardEvent): void;
	/** Follows a date link: `onNavLink`, or switches to `view` at `day`. */
	navigate(day: Day, jsEvent: MouseEvent | KeyboardEvent, view?: "day" | "month"): void;
	/** Swallows the click that follows a drag the view handled itself. */
	suppressNextClick(): void;
	/** Row override for the item being dragged in the timeline. */
	readonly dragRow: { id: string; rowId: string } | null;
}

export interface View {
	readonly el: HTMLElement;
	/** Rebuilds everything when `change` is null; otherwise only what it touched. */
	render(change: StoreChange | null): void;
	hit(clientX: number, clientY: number): Hit | null;
	showSelection(sel: Selection | null): void;
	/** Called once a minute. */
	tick?(): void;
	resize?(): void;
	getScroll(): { top: number; left: number };
	setScroll(s: { top: number; left: number }): void;
	scrollToTime?(minute: number): void;
	/** Item elements currently shown for an id. */
	elementsFor(id: string): HTMLElement[];
	destroy(): void;
}

/**
 * Keyed element reuse within one container. Elements survive re-layout and are
 * only rebuilt when the item's signature changes, so mount hooks fire once per
 * real change.
 */
/** Selector for a focusable part of an item element, by its tnc- classes. */
function focusKey(el: Element): string {
	const cls = [...el.classList].filter((c) => c.startsWith("tnc-"));
	return cls.length ? cls.map((c) => `.${CSS.escape(c)}`).join("") : "";
}

export class ItemPool<D> {
	private readonly recs = new Map<string, { el: HTMLElement; sig: string }>();
	private used = new Set<string>();

	constructor(
		private readonly ctx: ViewContext<D>,
		readonly container: HTMLElement,
	) {}

	begin(): void {
		this.used = new Set();
	}

	place(key: string, meta: ElMeta<D>): HTMLElement {
		const sig = `${meta.n.sig}|${meta.variant}|${meta.isStart ? 1 : 0}${meta.isEnd ? 1 : 0}|${meta.mirror ? 1 : 0}`;
		let rec = this.recs.get(key);
		// A rebuilt element takes over keyboard focus from the one it replaces.
		let refocus: string | null = null;
		if (rec && rec.sig !== sig) {
			const active = this.ctx.doc.activeElement;
			if (active && rec.el.contains(active)) refocus = active === rec.el ? "" : focusKey(active);
			this.ctx.destroyItemEl(rec.el);
			rec = undefined;
		}
		if (!rec) {
			rec = { el: this.ctx.createItemEl(meta), sig };
			this.recs.set(key, rec);
			this.container.append(rec.el);
			if (refocus !== null) (refocus ? rec.el.querySelector<HTMLElement>(refocus) : rec.el)?.focus({ preventScroll: true });
		} else {
			this.ctx.meta.set(rec.el, meta);
			this.ctx.refreshItemEl(rec.el, meta);
			if (rec.el.parentNode !== this.container) this.container.append(rec.el);
		}
		this.used.add(key);
		return rec.el;
	}

	end(): void {
		for (const [key, rec] of this.recs) {
			if (this.used.has(key)) continue;
			this.ctx.destroyItemEl(rec.el);
			this.recs.delete(key);
		}
	}

	clear(): void {
		this.begin();
		this.end();
	}

	elementsFor(id: string): HTMLElement[] {
		const out: HTMLElement[] = [];
		for (const rec of this.recs.values()) if (this.ctx.meta.get(rec.el)?.n.id === id) out.push(rec.el);
		return out;
	}
}
