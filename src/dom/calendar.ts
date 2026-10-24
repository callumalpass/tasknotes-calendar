import {
	addMonths,
	type Day,
	formatDay,
	MINUTES_PER_DAY,
	parseDurationMinutes,
	startOfMonth,
	startOfWeek,
	startOfYear,
	weekdayOf,
} from "../core/date";
import type { ItemOrder } from "../core/layout";
import { parseOrder } from "../core/order";
import { dependencyConflicts } from "../core/plan";
import { ItemStore, type StoreChange } from "../core/store";
import type { CalendarItem, DateInput, DateRange, NormalizedItem } from "../core/types";
import { dayOf, formatFloating, getTimeZone, parseDateInput, type TimeZone, toInstant, wallTime } from "../core/zone";
import { type ElMeta, ItemPool, type Selection, type View, type ViewContext } from "./context";
import { classList, h, setStyle } from "./dom";
import { Formatter, localeFirstDay } from "./format";
import {
	type CalendarOptions,
	type CalendarText,
	DEFAULT_TEXT,
	type DayArg,
	defaultOptions,
	type ExternalDragSource,
	type Hit,
	type ItemArg,
	type ItemChangeArg,
	LAYOUT_KEYS,
	type ToolbarOptions,
	type ViewInfo,
	type ViewType,
} from "./options";
import { DayGridView } from "./views/daygrid";
import { ListView } from "./views/list";
import { TimeGridView } from "./views/timegrid";
import { TimelineView } from "./views/timeline";
import { YearView } from "./views/year";

const EXTERNAL_ID = "__tnc_external__";

type DragMode = "move" | "resize-end" | "resize-start" | "select" | "external";

interface Proposal {
	startMs: number;
	endMs: number;
	allDay: boolean;
	startDay: Day;
	endDay: Day;
	rowId?: string;
}

interface Session<D> {
	mode: DragMode;
	pointerId: number;
	pointerType: string;
	x0: number;
	y0: number;
	active: boolean;
	origin: NormalizedItem<D> | null;
	grab: Hit | null;
	proposal: Proposal | null;
	denied: boolean;
	timer: number | null;
	lastEvent: PointerEvent | null;
	source?: ExternalDragSource<D>;
	/** Touch on a draggable item scrolls by hand: its `touch-action: none` stops native panning. */
	pan?: { el: HTMLElement; left: number; top: number; active: boolean };
}

/**
 * Option equality that ignores identity churn from frameworks: functions are
 * equal if both exist (callbacks are always read live), and plain objects and
 * arrays compare by value.
 */
function sameOption(a: unknown, b: unknown, depth = 0): boolean {
	if (a === b) return true;
	if (typeof a === "function" && typeof b === "function") return true;
	if (depth > 4 || !a || !b || typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((v, i) => sameOption(v, b[i], depth + 1));
	}
	if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	return ka.every((k) => sameOption((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1));
}

function sameProposal(a: Proposal | null, b: Proposal | null): boolean {
	return !!a && !!b && a.startMs === b.startMs && a.endMs === b.endMs && a.allDay === b.allDay && a.rowId === b.rowId;
}

/**
 * A calendar bound to one element. Works in any document, including Obsidian
 * popout windows: all listeners, timers and observers use the element's window.
 */
export class Calendar<D = unknown> implements ViewContext<D> {
	readonly doc: Document;
	readonly win: Window;
	readonly root: HTMLElement;
	readonly store: ItemStore<D>;
	readonly meta = new WeakMap<Element, ElMeta<D>>();
	opts: CalendarOptions<D>;
	zone: TimeZone;
	fmt: Formatter;
	text: CalendarText;
	order: ItemOrder<D>;
	view!: ViewInfo;
	firstDay = 0;
	days: Day[] = [];
	today: Day = 0;
	conflicts: Map<string, string[]> = new Map();
	slot = { min: 0, max: MINUTES_PER_DAY, duration: 30, snap: 30, scroll: 480 };
	draggingId: string | null = null;
	dragRow: { id: string; rowId: string } | null = null;

	private readonly toolbarEl: HTMLElement;
	private readonly viewHost: HTMLElement;
	private current: View | null = null;
	private anchor: Day = 0;
	private session: Session<D> | null = null;
	private selection: Selection | null = null;
	private suppressClick = false;
	private popover: { el: HTMLElement; pool: ItemPool<D>; anchor: HTMLElement; day: Day } | null = null;
	private timer: number | null = null;
	private resizeObs: ResizeObserver | null = null;
	private destroyed = false;
	private pendingChange: StoreChange | null = null;
	private frame: number | null = null;

	constructor(
		readonly host: HTMLElement,
		options: Partial<CalendarOptions<D>> = {},
		items: Iterable<CalendarItem<D>> = [],
	) {
		this.doc = host.ownerDocument;
		this.win = (this.doc.defaultView ?? (globalThis as unknown as Window));
		this.opts = { ...defaultOptions<D>(), ...options };
		this.zone = getTimeZone(this.opts.timeZone);
		this.fmt = new Formatter(this.opts.locale, this.opts.hour12);
		this.text = this.resolveText();
		this.order = parseOrder(this.opts.eventOrder);
		this.store = new ItemStore<D>(this.zone, {
			defaultTimedMinutes: this.opts.defaultTimedMinutes,
			defaultAllDayDays: this.opts.defaultAllDayDays,
		});
		this.store.setAll(items);
		this.conflicts = dependencyConflicts(this.store);
		this.anchor = this.toDay(this.opts.date) ?? this.todayDay();

		this.root = h(this.doc, "div", "tnc", { "data-tnc": "" });
		this.toolbarEl = h(this.doc, "div", "tnc-toolbar", { role: "toolbar" });
		this.viewHost = h(this.doc, "div", "tnc-view");
		this.root.append(this.toolbarEl, this.viewHost);
		host.append(this.root);

		this.bindEvents();
		this.rebuild(true);
		this.scheduleTick();
		const RO = (this.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
		if (RO) {
			this.resizeObs = new RO(() => this.current?.resize?.());
			this.resizeObs.observe(this.root);
		}
	}

	/* ================================================================ public */

	/** Replaces all items, re-rendering only what changed. */
	setItems(items: Iterable<CalendarItem<D>>): void {
		const drag = this.session?.active && this.session.origin ? this.store.get(this.session.origin.id) : undefined;
		const change = this.store.setAll(items);
		// Keep the dragged item where the pointer is until the drag ends.
		if (drag && this.session?.origin) {
			const fresh = this.store.get(drag.id);
			if (fresh) this.session.origin = fresh;
			this.merge(change, this.store.upsert([drag.item]));
		}
		this.applyChange(change);
	}

	upsertItems(items: Iterable<CalendarItem<D>>): void {
		this.applyChange(this.store.upsert(items));
	}

	removeItems(ids: Iterable<string>): void {
		this.applyChange(this.store.remove(ids));
	}

	getItem(id: string): CalendarItem<D> | undefined {
		return this.store.get(id)?.item;
	}

	/** Updates options. Only what the change affects is rebuilt. */
	setOptions(next: Partial<CalendarOptions<D>>): void {
		const prev = this.opts;
		this.opts = { ...prev, ...next };
		const changed = (Object.keys(next) as (keyof CalendarOptions<D>)[]).filter(
			(k) => !sameOption((next as Record<string, unknown>)[k], (prev as unknown as Record<string, unknown>)[k]),
		);
		if (!changed.length) return;
		const has = (k: keyof CalendarOptions<D>) => changed.includes(k);
		if (has("timeZone") || has("defaultTimedMinutes") || has("defaultAllDayDays")) {
			this.zone = getTimeZone(this.opts.timeZone);
			this.store.reconfigure(this.zone, {
				defaultTimedMinutes: this.opts.defaultTimedMinutes,
				defaultAllDayDays: this.opts.defaultAllDayDays,
			});
		}
		if (has("locale") || has("hour12")) this.fmt = new Formatter(this.opts.locale, this.opts.hour12);
		if (has("text") || has("locale")) this.text = this.resolveText();
		if (has("eventOrder")) this.order = parseOrder(this.opts.eventOrder);
		if (has("date")) this.anchor = this.toDay(this.opts.date) ?? this.anchor;
		const needsRebuild = changed.some((k) => LAYOUT_KEYS.has(k)) || has("date");
		if (needsRebuild) this.rebuild(has("view") || has("date"));
	}

	/** Re-renders everything, e.g. after render hooks start returning different content. */
	rerender(): void {
		this.rebuild(false);
	}

	getOptions(): Readonly<CalendarOptions<D>> {
		return this.opts;
	}

	changeView(view: ViewType, date?: DateInput): void {
		if (date !== undefined) this.anchor = this.toDay(date) ?? this.anchor;
		if (view === this.opts.view && date === undefined) return;
		this.opts = { ...this.opts, view };
		this.rebuild(true);
		this.opts.onViewChange?.(this.view);
	}

	gotoDate(date: DateInput): void {
		const day = this.toDay(date);
		if (day === null) return;
		this.anchor = day;
		this.rebuild(true);
	}

	prev(): void {
		this.anchor = this.step(-1);
		this.rebuild(true);
	}

	next(): void {
		this.anchor = this.step(1);
		this.rebuild(true);
	}

	goToday(): void {
		this.anchor = this.todayDay();
		this.rebuild(true);
	}

	/** The anchor date, as local midnight of that civil day in the calendar zone. */
	getDate(): Date {
		return new Date(toInstant(this.anchor, 0, this.zone));
	}

	getView(): ViewInfo {
		return this.view;
	}

	/** Clears the current selection. */
	unselect(): void {
		if (!this.selection) return;
		this.selection = null;
		this.current?.showSelection(null);
		this.opts.onUnselect?.();
	}

	/** Re-measures (e.g. after the host was shown or resized by a parent). */
	updateSize(): void {
		this.current?.resize?.();
	}

	getScroll(): { top: number; left: number } {
		return this.current?.getScroll() ?? { top: 0, left: 0 };
	}

	setScroll(s: { top: number; left: number }): void {
		this.current?.setScroll(s);
	}

	scrollToTime(time: string | number): void {
		this.current?.scrollToTime?.(parseDurationMinutes(time, this.slot.scroll));
	}

	/** Item elements currently rendered for an id. */
	elementsFor(id: string): HTMLElement[] {
		return this.current?.elementsFor(id) ?? [];
	}

	/**
	 * Starts dragging something from outside the calendar (a task tray, an
	 * unscheduled list). Call from a pointerdown handler; the calendar follows
	 * the pointer and fires `onExternalDrop` on release.
	 */
	beginExternalDrag(ev: PointerEvent, source: ExternalDragSource<D>): void {
		this.endSession(null, true);
		this.session = {
			mode: "external",
			pointerId: ev.pointerId,
			pointerType: ev.pointerType,
			x0: ev.clientX,
			y0: ev.clientY,
			active: true,
			origin: null,
			grab: null,
			proposal: null,
			denied: false,
			timer: null,
			lastEvent: ev,
			source,
		};
		this.root.classList.add("tnc-dragging", "tnc-dragging-external");
		this.listenDoc(true);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.endSession(null, true);
		this.closeMore();
		if (this.timer !== null) this.win.clearTimeout(this.timer);
		if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
		this.resizeObs?.disconnect();
		this.unbindEvents();
		this.current?.destroy();
		this.current = null;
		this.root.remove();
	}

	/* ========================================================== view context */

	now(): number {
		return Date.now();
	}

	dayArg(day: Day): DayArg {
		return {
			day,
			date: new Date(toInstant(day, 0, this.zone)),
			dateStr: formatDay(day),
			view: this.view,
			isToday: day === this.today,
			isPast: day < this.today,
		};
	}

	dayClasses(day: Day): string[] {
		const out: string[] = [];
		const wd = weekdayOf(day);
		if (wd === 0 || wd === 6) out.push("is-weekend");
		if (day === this.today && this.opts.todayHighlight) out.push("is-today");
		if (day < this.today) out.push("is-past");
		out.push(...classList(this.opts.dayClassNames?.(this.dayArg(day))));
		return out;
	}

	isEditable(n: NormalizedItem<D>, what: "start" | "duration"): boolean {
		if (n.id === EXTERNAL_ID || this.opts.view === "list" || this.opts.view === "year") return false;
		const it = n.item;
		const base = it.editable ?? this.opts.editable;
		const specific = what === "start" ? it.startEditable : it.durationEditable;
		return specific ?? base;
	}

	navLink(day: Day, label: Node | string, cls: string): HTMLElement {
		const btn = h(this.doc, "button", `tnc-navlink ${cls}`, { type: "button", "data-nav-date": formatDay(day) }, label);
		btn.addEventListener("click", (ev) => {
			ev.stopPropagation();
			this.navigate(day, ev);
		});
		btn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
		return btn;
	}

	navigate(day: Day, jsEvent: MouseEvent | KeyboardEvent, view: "day" | "month" = "day"): void {
		if (this.opts.onNavLink) {
			this.opts.onNavLink({ ...this.dayArg(day), target: view, jsEvent });
			return;
		}
		this.changeView(view, formatDay(day));
	}

	createItemEl(meta: ElMeta<D>): HTMLElement {
		const { n, variant } = meta;
		const it = n.item;
		const el = h(this.doc, "div", "tnc-item");
		el.classList.add(`tnc-item--${variant}`);
		if (it.kind) el.classList.add(`tnc-k-${it.kind.replace(/[^\w-]/g, "-")}`);
		if (it.completed) el.classList.add("is-completed");
		if (it.display === "background") el.classList.add("is-background");
		if (it.lane === "actual") el.classList.add("is-actual");
		if (!meta.isStart) el.classList.add("is-cont-start");
		if (!meta.isEnd) el.classList.add("is-cont-end");
		if (n.allDay) el.classList.add("is-all-day");
		if (meta.mirror || n.id === EXTERNAL_ID) el.classList.add("is-mirror");
		if (this.conflicts.has(n.id)) el.classList.add("is-conflict");
		if (!meta.mirror && (this.isEditable(n, "start") || this.isEditable(n, "duration"))) el.classList.add("is-draggable");
		if (this.draggingId === n.id) el.classList.add("is-dragging");
		el.classList.add(...classList(it.className));
		const arg = this.itemArg(el, meta);
		el.classList.add(...classList(this.opts.itemClassNames?.(arg)));
		el.dataset.id = n.id;
		if (it.kind) el.dataset.kind = it.kind;
		const color = it.color ?? it.borderColor;
		if (color) el.style.setProperty("--tnc-c", color);
		if (it.backgroundColor) el.style.setProperty("--tnc-bg", it.backgroundColor);
		if (it.borderColor) el.style.setProperty("--tnc-border", it.borderColor);
		if (it.textColor) el.style.setProperty("--tnc-fg", it.textColor);
		if (it.display !== "background") {
			el.tabIndex = 0;
			el.setAttribute("role", "button");
			el.setAttribute("aria-label", this.ariaLabel(n));
		}
		this.meta.set(el, meta);

		const custom = variant === "list" ? this.opts.listItemContent?.(arg) : null;
		const content = custom ?? this.opts.itemContent?.(arg);
		if (content != null) {
			const wrap = h(this.doc, "div", "tnc-item-main");
			wrap.append(content);
			el.append(wrap);
		} else {
			el.append(this.defaultContent(meta));
		}
		if (variant !== "list" && it.display !== "background") this.addHandles(el, meta);
		this.opts.itemDidMount?.(arg);
		return el;
	}

	refreshItemEl(el: HTMLElement, meta: ElMeta<D>): void {
		const time = el.querySelector<HTMLElement>(":scope .tnc-item-time");
		if (time) this.fillTime(time, meta.n, meta.variant, meta.day);
		el.classList.toggle("is-dragging", this.draggingId === meta.n.id);
		el.classList.toggle("is-conflict", this.conflicts.has(meta.n.id));
	}

	destroyItemEl(el: HTMLElement): void {
		const meta = this.meta.get(el);
		if (meta) this.opts.itemWillUnmount?.(this.itemArg(el, meta));
		el.remove();
	}

	openMore(day: Day, anchor: HTMLElement, jsEvent: MouseEvent | KeyboardEvent): void {
		jsEvent.stopPropagation();
		const items = this.store
			.inRange(day, day + 1)
			.filter((n) => n.item.display !== "background" && (n.allDay || this.opts.view === "month" || !this.opts.timeGrid || this.opts.eventMaxStack > 0))
			.sort((a, b) => Number(b.allDay) - Number(a.allDay) || this.order(a, b));
		const shown = new Set(
			[...this.viewHost.querySelectorAll<HTMLElement>(".tnc-item")]
				.filter((el) => this.meta.get(el)?.day === day || (this.meta.get(el)?.n.startDay ?? Infinity) <= day)
				.map((el) => el.dataset.id ?? ""),
		);
		const res = this.opts.onMoreClick?.({
			day,
			date: new Date(toInstant(day, 0, this.zone)),
			items: items.map((n) => n.item),
			hidden: items.filter((n) => !shown.has(n.id)).map((n) => n.item),
			jsEvent,
			el: anchor,
			view: this.view,
		});
		if (res === false) return;
		this.closeMore();
		const el = h(this.doc, "div", "tnc-popover", { role: "dialog", "aria-label": this.fmt.longDate(day), tabindex: "-1" });
		const close = h(this.doc, "button", "tnc-popover-close", { type: "button", "aria-label": "Close" }, "×");
		close.addEventListener("click", () => this.closeMore(true));
		const title = this.opts.navLinks ? this.navLink(day, this.fmt.longDate(day), "tnc-popover-title") : h(this.doc, "div", "tnc-popover-title", null, this.fmt.longDate(day));
		const body = h(this.doc, "div", "tnc-popover-body");
		el.append(h(this.doc, "div", "tnc-popover-head", null, title, close), body);
		this.root.append(el);
		const pool = new ItemPool<D>(this, body);
		pool.begin();
		for (const n of items) {
			pool.place(n.id, { n, day, isStart: n.startDay >= day, isEnd: n.endDay <= day + 1, variant: n.allDay ? "bar" : "dot", mirror: false });
		}
		pool.end();
		this.popover = { el, pool, anchor, day };
		// Position within the calendar.
		const rr = this.root.getBoundingClientRect();
		const ar = anchor.getBoundingClientRect();
		const w = Math.max(220, ar.width + 24);
		let left = ar.left - rr.left - 12;
		left = Math.max(4, Math.min(left, rr.width - w - 4));
		let top = ar.top - rr.top - 40;
		const height = el.offsetHeight;
		top = Math.max(4, Math.min(top, rr.height - height - 4));
		setStyle(el, { left, top, width: w });
		el.focus();
	}

	/* =============================================================== render */

	private resolveText(): CalendarText {
		const t = this.opts.text;
		return {
			...DEFAULT_TEXT,
			...t,
			views: { ...DEFAULT_TEXT.views, ...t.views },
			viewHints: { ...DEFAULT_TEXT.viewHints, ...t.viewHints },
		};
	}

	private todayDay(): Day {
		return dayOf(this.now(), this.zone);
	}

	private toDay(date: DateInput | undefined): Day | null {
		if (date === undefined || date === null) return null;
		const p = parseDateInput(date, this.zone);
		if (!p) return null;
		return p.kind === "day" ? p.day : dayOf(p.ms, this.zone);
	}

	private step(dir: 1 | -1): Day {
		const { view, dayCount, listDayCount } = this.opts;
		switch (view) {
			case "day":
				return this.anchor + dir;
			case "days":
				return this.anchor + dir * Math.max(1, dayCount);
			case "week":
				return this.anchor + dir * 7;
			case "list":
				return this.anchor + dir * Math.max(1, listDayCount);
			case "month":
				return addMonths(startOfMonth(this.anchor), dir);
			case "year":
				return addMonths(startOfYear(this.anchor), 12 * dir);
			case "timeline": {
				const len = this.opts.timeline?.days ?? 120;
				return this.anchor + dir * Math.max(7, Math.round(len / 3));
			}
		}
	}

	private computeRange(): { startDay: Day; endDay: Day } {
		const { view, dayCount, listDayCount } = this.opts;
		const a = this.anchor;
		switch (view) {
			case "day":
				return { startDay: a, endDay: a + 1 };
			case "days":
				return { startDay: a, endDay: a + Math.max(1, dayCount) };
			case "week": {
				const s = startOfWeek(a, this.firstDay);
				return { startDay: s, endDay: s + 7 };
			}
			case "list":
				return { startDay: a, endDay: a + Math.max(1, listDayCount) };
			case "month": {
				const s = startOfWeek(startOfMonth(a), this.firstDay);
				return { startDay: s, endDay: s + 42 };
			}
			case "year": {
				const s = startOfYear(a);
				return { startDay: s, endDay: addMonths(s, 12) };
			}
			case "timeline": {
				const lead = this.opts.timeline?.leadDays ?? 14;
				const len = this.opts.timeline?.days ?? 120;
				return { startDay: a - lead, endDay: a - lead + len };
			}
		}
	}

	private computeTitle(startDay: Day, endDay: Day): string {
		const { view } = this.opts;
		if (view === "month") return this.fmt.monthYear(this.anchor);
		if (view === "year") return this.fmt.year(this.anchor);
		if (view === "day") return this.fmt.fullDate(this.anchor);
		const visible = this.days;
		const first = visible[0] ?? startDay;
		const last = visible[visible.length - 1] ?? endDay - 1;
		return this.fmt.range(first, last);
	}

	private rebuild(navigated: boolean): void {
		const scroll = navigated ? null : this.current?.getScroll();
		this.closeMore();
		this.unselectSilently();
		this.firstDay = this.opts.firstDay ?? localeFirstDay(this.opts.locale);
		this.today = this.todayDay();
		const min = parseDurationMinutes(this.opts.slotMinTime, 0);
		const max = Math.max(min + 30, parseDurationMinutes(this.opts.slotMaxTime, MINUTES_PER_DAY));
		const duration = Math.max(1, parseDurationMinutes(this.opts.slotDuration, 30));
		const snap = Math.max(1, parseDurationMinutes(this.opts.snapDuration ?? null, duration));
		this.slot = { min, max, duration, snap, scroll: parseDurationMinutes(this.opts.scrollTime, 480) };

		const { startDay, endDay } = this.computeRange();
		const hidden = new Set(this.opts.hiddenDays);
		if (!this.opts.weekends) {
			hidden.add(0);
			hidden.add(6);
		}
		const days: Day[] = [];
		const listLike = this.opts.view === "year" || this.opts.view === "timeline" || this.opts.view === "day";
		for (let d = startDay; d < endDay; d++) if (listLike || !hidden.has(weekdayOf(d))) days.push(d);
		// Never hide everything.
		this.days = days.length ? days : [startDay];
		const range: DateRange = {
			startDay,
			endDay,
			start: new Date(toInstant(startDay, 0, this.zone)),
			end: new Date(toInstant(endDay, 0, this.zone)),
		};
		const prevView = this.view;
		this.view = { type: this.opts.view, range, anchor: this.anchor, title: "" };
		this.view.title = this.computeTitle(startDay, endDay);
		this.conflicts = dependencyConflicts(this.store);

		this.root.className = "tnc";
		this.root.classList.add(`tnc--${this.opts.view}`, `tnc--height-${this.opts.height}`);
		if (!this.opts.timeGrid) this.root.classList.add("tnc--no-time-grid");
		this.renderToolbar();

		this.current?.destroy();
		this.current = this.createView();
		this.viewHost.replaceChildren(this.current.el);
		this.current.render(null);
		if (scroll) this.current.setScroll(scroll);
		else if (this.current instanceof TimeGridView) this.current.scrollToTime(this.slot.scroll);
		else if (this.current instanceof TimelineView) this.current.scrollToDay(this.anchor);

		const rangeChanged =
			!prevView || prevView.type !== this.view.type || prevView.range.startDay !== startDay || prevView.range.endDay !== endDay;
		if (rangeChanged) this.opts.onRangeChange?.(this.view);
	}

	private createView(): View {
		switch (this.opts.view) {
			case "month":
				return new DayGridView(this);
			case "list":
				return new ListView(this);
			case "year":
				return new YearView(this);
			case "timeline":
				return new TimelineView(this);
			default:
				return new TimeGridView(this);
		}
	}

	private renderToolbar(): void {
		const tb = this.opts.toolbar;
		this.toolbarEl.replaceChildren();
		this.toolbarEl.hidden = !tb;
		if (!tb) return;
		const cfg: ToolbarOptions = tb === true ? {} : tb;
		const views = cfg.views ?? (["month", "week", "days", "day", "list", "year"] as ViewType[]);
		const btn = (label: string, hint: string, cls: string, onClick: (ev: MouseEvent) => void, pressed?: boolean) => {
			const b = h(this.doc, "button", `tnc-btn ${cls}`, { type: "button", title: hint, "aria-label": hint }, label);
			if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
			b.addEventListener("click", onClick);
			return b;
		};
		const extras = (cfg.extraButtons ?? []).map((e) => {
			const b = btn(e.text, e.hint ?? e.text, `tnc-btn-extra tnc-btn-${e.id}`, (ev) => e.onClick(ev));
			if (e.icon) b.replaceChildren(e.icon());
			return b;
		});
		const nav = h(
			this.doc,
			"div",
			"tnc-toolbar-group tnc-toolbar-nav",
			null,
			btn("‹", this.text.prev, "tnc-btn-prev", () => this.prev()),
			btn(this.text.today, this.text.today, "tnc-btn-today", () => this.goToday()),
			btn("›", this.text.next, "tnc-btn-next", () => this.next()),
		);
		const title = h(this.doc, "h2", "tnc-title", { "aria-live": "polite" }, this.view.title);
		const viewGroup = h(this.doc, "div", "tnc-toolbar-group tnc-toolbar-views", { role: "group" });
		for (const v of views) {
			const label = v === "days" ? (this.text.views.days ?? `${this.opts.dayCount} days`) : (this.text.views[v] ?? v);
			viewGroup.append(btn(label, this.text.viewHints[v] ?? label, `tnc-btn-view tnc-btn-view-${v}`, () => this.changeView(v), v === this.opts.view));
		}
		const start = h(this.doc, "div", "tnc-toolbar-start");
		const end = h(this.doc, "div", "tnc-toolbar-end");
		if (cfg.extraPlacement === "start") start.append(...extras);
		start.append(nav, title);
		end.append(viewGroup);
		if (cfg.extraPlacement !== "start") end.append(...extras);
		this.toolbarEl.append(start, end);
	}

	private applyChange(change: StoreChange): void {
		if (!change.added.length && !change.updated.length && !change.removed.length && !change.days.size && !change.spans) return;
		this.conflicts = dependencyConflicts(this.store);
		this.pendingChange = this.pendingChange ? this.merge(this.pendingChange, change) : change;
		// Coalesce bursts of updates into one frame; drags render immediately.
		if (this.session?.active) {
			this.flush();
			return;
		}
		if (this.frame === null) this.frame = this.win.requestAnimationFrame(() => this.flush());
	}

	/** Renders pending changes now. Called automatically on the next frame. */
	flush(): void {
		if (this.frame !== null) {
			this.win.cancelAnimationFrame(this.frame);
			this.frame = null;
		}
		const change = this.pendingChange;
		this.pendingChange = null;
		if (!change || !this.current) return;
		this.current.render(change);
		if (this.selection) this.current.showSelection(this.selection);
		if (this.popover) this.refreshMore();
	}

	private merge(a: StoreChange, b: StoreChange): StoreChange {
		for (const d of b.days) a.days.add(d);
		a.added.push(...b.added);
		a.updated.push(...b.updated);
		a.removed.push(...b.removed);
		a.spans ||= b.spans;
		return a;
	}

	private scheduleTick(): void {
		const delay = 60_000 - (this.now() % 60_000) + 50;
		this.timer = this.win.setTimeout(() => {
			if (this.destroyed) return;
			if (this.todayDay() !== this.today) this.rebuild(false);
			else this.current?.tick?.();
			this.scheduleTick();
		}, delay);
	}

	/* ========================================================= item content */

	private itemArg(el: HTMLElement, meta: ElMeta<D>): ItemArg<D> {
		return { item: meta.n.item, el, view: this.view, day: meta.day, isStart: meta.isStart, isEnd: meta.isEnd, isMirror: meta.mirror };
	}

	/** Start and (for timed and list items) end labels; the end is hidden on short items by CSS. */
	private timeLabel(n: NormalizedItem<D>, variant: ElMeta["variant"], day: Day): { start: string; end: string } {
		if (n.allDay) return { start: variant === "list" ? this.text.allDay : "", end: "" };
		const s = wallTime(n.startMs, this.zone);
		const start = this.fmt.time(s.minute, true);
		if (variant === "dot" || variant === "bar") return { start: s.day === day ? start : "", end: "" };
		if (n.startMs === n.endMs) return { start, end: "" };
		return { start, end: this.fmt.time(wallTime(n.endMs, this.zone).minute, true) };
	}

	private fillTime(el: HTMLElement, n: NormalizedItem<D>, variant: ElMeta["variant"], day: Day): boolean {
		const { start, end } = this.timeLabel(n, variant, day);
		el.textContent = start;
		if (end) el.append(h(this.doc, "span", "tnc-item-time-end", null, ` – ${end}`));
		return start !== "";
	}

	private ariaLabel(n: NormalizedItem<D>): string {
		if (n.allDay) {
			const last = n.endDay - 1;
			return `${n.item.title}, ${last > n.startDay ? this.fmt.range(n.startDay, last) : this.fmt.longDate(n.startDay)}`;
		}
		const s = wallTime(n.startMs, this.zone);
		const e = wallTime(n.endMs, this.zone);
		return `${n.item.title}, ${this.fmt.longDate(s.day)} ${this.fmt.time(s.minute)} – ${this.fmt.time(e.minute)}`;
	}

	private defaultContent(meta: ElMeta<D>): HTMLElement {
		const { n, variant, day } = meta;
		const doc = this.doc;
		const main = h(doc, "div", "tnc-item-main");
		const title = h(doc, "span", "tnc-item-title", null, n.item.title);
		const time = h(doc, "span", "tnc-item-time");
		const label = this.fillTime(time, n, variant, day);
		switch (variant) {
			case "timed":
				main.append(title, time);
				break;
			case "dot":
				main.append(h(doc, "span", "tnc-item-dot", { "aria-hidden": "true" }), time, title);
				break;
			case "list":
				main.append(time, h(doc, "span", "tnc-item-dot", { "aria-hidden": "true" }), title);
				break;
			default:
				if (label) main.append(time);
				main.append(title);
		}
		return main;
	}

	private addHandles(el: HTMLElement, meta: ElMeta<D>): void {
		const { n, variant } = meta;
		if (!this.isEditable(n, "duration")) {
			if (variant === "timeline" && this.opts.timeline?.onLink) this.addPorts(el);
			return;
		}
		const vertical = variant === "timed";
		if (variant === "dot") return;
		if (meta.isEnd && !(variant === "timeline" && n.item.kind === "milestone")) {
			el.append(h(this.doc, "div", `tnc-resize tnc-resize-end ${vertical ? "is-v" : "is-h"}`, { "aria-hidden": "true" }));
		}
		if (meta.isStart && (this.opts.resizableFromStart || variant === "timeline") && n.item.kind !== "milestone") {
			el.append(h(this.doc, "div", `tnc-resize tnc-resize-start ${vertical ? "is-v" : "is-h"}`, { "aria-hidden": "true" }));
		}
		if (variant === "timeline" && this.opts.timeline?.onLink) this.addPorts(el);
	}

	private addPorts(el: HTMLElement): void {
		el.append(h(this.doc, "span", "tnc-port tnc-port-out", { "aria-hidden": "true", title: "Drag to link" }));
	}

	/* ============================================================== popover */

	private refreshMore(): void {
		const p = this.popover;
		if (!p) return;
		const items = this.store
			.inRange(p.day, p.day + 1)
			.filter((n) => n.item.display !== "background")
			.sort((a, b) => Number(b.allDay) - Number(a.allDay) || this.order(a, b));
		p.pool.begin();
		for (const n of items) {
			p.pool.place(n.id, { n, day: p.day, isStart: n.startDay >= p.day, isEnd: n.endDay <= p.day + 1, variant: n.allDay ? "bar" : "dot", mirror: false });
		}
		p.pool.end();
	}

	private closeMore(restoreFocus = false): void {
		const p = this.popover;
		if (!p) return;
		this.popover = null;
		p.pool.clear();
		p.el.remove();
		if (restoreFocus && p.anchor.isConnected) p.anchor.focus();
	}

	/* =========================================================== interaction */

	private bindEvents(): void {
		const r = this.root;
		r.addEventListener("pointerdown", this.onPointerDown);
		r.addEventListener("click", this.onClick);
		r.addEventListener("dblclick", this.onDblClick);
		r.addEventListener("contextmenu", this.onContextMenu);
		r.addEventListener("mouseover", this.onMouseOver);
		r.addEventListener("mouseout", this.onMouseOut);
		r.addEventListener("keydown", this.onKeyDown);
		r.addEventListener("dragover", this.onNativeDragOver);
		r.addEventListener("dragleave", this.onNativeDragLeave);
		r.addEventListener("drop", this.onNativeDrop);
		// Must exist before touchstart: Chrome decides then whether a touch sequence can be blocked.
		r.addEventListener("touchmove", this.onTouchMove, { passive: false });
		this.doc.addEventListener("pointerdown", this.onDocPointerDown, true);
	}

	private unbindEvents(): void {
		const r = this.root;
		r.removeEventListener("pointerdown", this.onPointerDown);
		r.removeEventListener("click", this.onClick);
		r.removeEventListener("dblclick", this.onDblClick);
		r.removeEventListener("contextmenu", this.onContextMenu);
		r.removeEventListener("mouseover", this.onMouseOver);
		r.removeEventListener("mouseout", this.onMouseOut);
		r.removeEventListener("keydown", this.onKeyDown);
		r.removeEventListener("dragover", this.onNativeDragOver);
		r.removeEventListener("dragleave", this.onNativeDragLeave);
		r.removeEventListener("drop", this.onNativeDrop);
		r.removeEventListener("touchmove", this.onTouchMove);
		this.doc.removeEventListener("pointerdown", this.onDocPointerDown, true);
		this.listenDoc(false);
	}

	private listenDoc(on: boolean): void {
		const d = this.doc;
		const fn = on ? d.addEventListener.bind(d) : d.removeEventListener.bind(d);
		fn("pointermove", this.onPointerMove as EventListener);
		fn("pointerup", this.onPointerUp as EventListener);
		fn("pointercancel", this.onPointerCancel as EventListener);
		fn("keydown", this.onDocKeyDown as EventListener, true);
	}

	private itemElFrom(target: EventTarget | null): HTMLElement | null {
		const el = (target as Element | null)?.closest?.<HTMLElement>(".tnc-item");
		return el && this.root.contains(el) && this.meta.has(el) ? el : null;
	}

	private readonly onDocPointerDown = (ev: PointerEvent) => {
		const t = ev.target as Node;
		if (this.popover && !this.popover.el.contains(t) && !this.popover.anchor.contains(t)) this.closeMore();
		if (this.selection && !this.root.contains(t)) this.unselect();
	};

	private readonly onPointerDown = (ev: PointerEvent) => {
		if (ev.button !== 0 || this.session) return;
		const target = ev.target as Element;
		if (target.closest("button, a, input, select, textarea, .tnc-toolbar, .tnc-port, [data-tnc-no-drag]")) {
			if (!target.closest(".tnc-item")) return;
			if (target.closest(".tnc-port, [data-tnc-no-drag], input, select, textarea")) return;
		}
		const itemEl = this.itemElFrom(target);
		let mode: DragMode | null = null;
		let origin: NormalizedItem<D> | null = null;
		if (itemEl) {
			const meta = this.meta.get(itemEl)!;
			origin = this.store.get(meta.n.id) ?? null;
			if (!origin || origin.id === EXTERNAL_ID) return;
			if (target.closest(".tnc-resize-end")) mode = this.isEditable(origin, "duration") ? "resize-end" : null;
			else if (target.closest(".tnc-resize-start")) mode = this.isEditable(origin, "duration") ? "resize-start" : null;
			else mode = this.isEditable(origin, "start") ? "move" : null;
			if (!mode) return;
		} else {
			if (!this.opts.selectable || !this.current) return;
			if (target.closest(".tnc-popover, .tnc-more")) return;
			const hit = this.current.hit(ev.clientX, ev.clientY);
			if (!hit) return;
			mode = "select";
		}
		const touch = ev.pointerType === "touch";
		const s: Session<D> = {
			mode,
			pointerId: ev.pointerId,
			pointerType: ev.pointerType,
			x0: ev.clientX,
			y0: ev.clientY,
			active: false,
			origin,
			grab: this.current?.hit(ev.clientX, ev.clientY) ?? null,
			proposal: null,
			denied: false,
			timer: null,
			lastEvent: ev,
		};
		this.session = s;
		if (touch && itemEl?.classList.contains("is-draggable")) {
			const el = itemEl.closest<HTMLElement>(".tnc-tg-scroll, .tnc-dg-scroll, .tnc-tl-scroll, .tnc-list-scroll, .tnc-year-scroll");
			if (el) s.pan = { el, left: el.scrollLeft, top: el.scrollTop, active: false };
		}
		if (touch) {
			s.timer = this.win.setTimeout(() => {
				if (this.session !== s) return;
				this.activate(s);
				navigator.vibrate?.(10);
			}, this.opts.longPressDelay);
		} else if (mode !== "select") {
			// Stop text selection while dragging items with a mouse.
			ev.preventDefault();
		}
		this.listenDoc(true);
	};

	private activate(s: Session<D>): void {
		s.active = true;
		if (s.timer !== null) this.win.clearTimeout(s.timer);
		s.timer = null;
		if (s.origin) {
			this.draggingId = s.origin.id;
			for (const el of this.elementsFor(s.origin.id)) el.classList.add("is-dragging");
		}
		this.closeMore();
		if (s.mode !== "select") this.unselectSilently();
		this.root.classList.add("tnc-dragging", `tnc-dragging-${s.mode}`);
		if (s.lastEvent) this.track(s, s.lastEvent);
	}

	private readonly onTouchMove = (ev: TouchEvent) => {
		if (this.session?.active) ev.preventDefault();
	};

	private readonly onPointerMove = (ev: PointerEvent) => {
		const s = this.session;
		if (!s || ev.pointerId !== s.pointerId) return;
		s.lastEvent = ev;
		if (!s.active) {
			const dist = Math.hypot(ev.clientX - s.x0, ev.clientY - s.y0);
			if (s.pointerType === "touch") {
				const pan = s.pan;
				if (pan && (pan.active || dist > 8)) {
					if (!pan.active && s.timer !== null) this.win.clearTimeout(s.timer);
					s.timer = null;
					pan.active = true;
					pan.el.scrollLeft = pan.left - (ev.clientX - s.x0);
					pan.el.scrollTop = pan.top - (ev.clientY - s.y0);
				} else if (dist > 8) this.endSession(null, true);
				return;
			}
			if (dist < 4) return;
			this.activate(s);
			return;
		}
		ev.preventDefault();
		this.track(s, ev);
	};

	private readonly onPointerUp = (ev: PointerEvent) => {
		const s = this.session;
		if (!s || ev.pointerId !== s.pointerId) return;
		if (!s.active) {
			// A tap or click without dragging.
			this.endSession(null, true);
			if (s.pan?.active) {
				this.suppressClick = true;
				this.win.setTimeout(() => (this.suppressClick = false), 0);
				return;
			}
			if (s.mode === "select" && s.grab) this.clickSlot(s.grab, ev, s.pointerType === "touch");
			return;
		}
		this.suppressClick = true;
		this.win.setTimeout(() => (this.suppressClick = false), 0);
		this.endSession(ev, false);
	};

	private readonly onPointerCancel = (ev: PointerEvent) => {
		if (this.session && ev.pointerId === this.session.pointerId) this.endSession(null, true);
	};

	private readonly onDocKeyDown = (ev: KeyboardEvent) => {
		if (ev.key === "Escape" && this.session) {
			ev.preventDefault();
			ev.stopPropagation();
			this.endSession(null, true);
		}
	};

	/** Proposal for the current pointer position. */
	private track(s: Session<D>, ev: PointerEvent): void {
		const hit = this.current?.hit(ev.clientX, ev.clientY) ?? null;
		if (s.mode === "external") {
			this.trackExternal(s, hit);
			return;
		}
		if (!s.grab) s.grab = hit;
		if (!hit || !s.grab) return;
		if (s.mode === "select") {
			const sel = this.selectionFor(s.grab, hit);
			if (!sel) return;
			this.selection = sel;
			this.current?.showSelection(sel);
			return;
		}
		const origin = s.origin!;
		const p = s.mode === "move" ? this.moveProposal(origin, s.grab, hit) : this.resizeProposal(origin, hit, s.mode === "resize-start");
		if (!p) return;
		const allowed = this.opts.canDrop?.({ item: origin.item, start: new Date(p.startMs), end: new Date(p.endMs), allDay: p.allDay, rowId: p.rowId }) ?? true;
		s.denied = !allowed;
		this.root.classList.toggle("tnc-drop-denied", !allowed);
		if (!allowed || sameProposal(p, s.proposal)) return;
		s.proposal = p;
		this.dragRow = p.rowId !== undefined ? { id: origin.id, rowId: p.rowId } : null;
		this.applyChange(this.store.upsert([this.withProposal(origin, p)]));
	}

	private trackExternal(s: Session<D>, hit: Hit | null): void {
		const src = s.source!;
		if (!hit) {
			if (s.proposal) {
				s.proposal = null;
				this.applyChange(this.store.remove([EXTERNAL_ID]));
			}
			return;
		}
		const dur = src.durationMinutes ?? this.opts.defaultTimedMinutes;
		let p: Proposal;
		if (hit.kind === "time" || (hit.kind === "timeline" && this.timelineSnap() < MINUTES_PER_DAY)) {
			const snap = hit.kind === "time" ? this.slot.snap : this.timelineSnap();
			const startCivil = Math.floor((hit.day * MINUTES_PER_DAY + hit.minute) / snap) * snap;
			const startMs = this.civilToMs(startCivil);
			const endMs = this.civilToMs(startCivil + dur);
			p = { startMs, endMs, allDay: false, startDay: dayOf(startMs, this.zone), endDay: dayOf(endMs - 1, this.zone) + 1 };
		} else {
			const day = hit.day;
			p = this.dayProposal(day, day + 1);
		}
		if (hit.kind === "timeline") p.rowId = hit.rowId;
		const allowed =
			this.opts.canDrop?.({ item: this.externalItem(src, p), start: new Date(p.startMs), end: new Date(p.endMs), allDay: p.allDay, rowId: p.rowId }) ?? true;
		s.denied = !allowed;
		this.root.classList.toggle("tnc-drop-denied", !allowed);
		if (sameProposal(p, s.proposal)) return;
		s.proposal = p;
		this.dragRow = p.rowId !== undefined ? { id: EXTERNAL_ID, rowId: p.rowId } : null;
		this.applyChange(this.store.upsert([this.externalItem(src, p)]));
	}

	private externalItem(src: ExternalDragSource<D>, p: Proposal): CalendarItem<D> {
		return {
			id: EXTERNAL_ID,
			title: src.title,
			kind: src.kind,
			color: src.color,
			start: p.allDay ? formatDay(p.startDay) : p.startMs,
			end: p.allDay ? formatDay(p.endDay) : p.endMs,
			allDay: p.allDay,
			editable: false,
			data: src.data,
			rev: `${p.startMs}:${p.endMs}:${p.allDay ? 1 : 0}:${p.rowId ?? ""}`,
		};
	}

	private timelineSnap(): number {
		return this.opts.timeline?.scale?.snapMinutes ?? MINUTES_PER_DAY;
	}

	private civil(ms: number): number {
		const w = wallTime(ms, this.zone);
		return w.day * MINUTES_PER_DAY + w.minute;
	}

	private civilToMs(c: number): number {
		const day = Math.floor(c / MINUTES_PER_DAY);
		return toInstant(day, c - day * MINUTES_PER_DAY, this.zone);
	}

	private hitCivil(hit: Hit): number {
		return hit.kind === "time" || hit.kind === "timeline" ? hit.day * MINUTES_PER_DAY + hit.minute : hit.day * MINUTES_PER_DAY;
	}

	private dayProposal(startDay: Day, endDay: Day): Proposal {
		return {
			startMs: toInstant(startDay, 0, this.zone),
			endMs: toInstant(endDay, 0, this.zone),
			allDay: true,
			startDay,
			endDay,
		};
	}

	private timedProposal(startMs: number, endMs: number): Proposal {
		return { startMs, endMs, allDay: false, startDay: dayOf(startMs, this.zone), endDay: dayOf(Math.max(startMs, endMs - 1), this.zone) + 1 };
	}

	private moveProposal(o: NormalizedItem<D>, grab: Hit, hit: Hit): Proposal | null {
		const days = o.endDay - o.startDay;
		if (hit.kind === "timeline") {
			const snap = o.allDay ? Math.max(MINUTES_PER_DAY, this.timelineSnap()) : this.timelineSnap();
			const delta = Math.round((this.hitCivil(hit) - this.hitCivil(grab)) / snap) * snap;
			let p: Proposal;
			if (o.allDay) {
				const dd = Math.round(delta / MINUTES_PER_DAY);
				p = this.dayProposal(o.startDay + dd, o.endDay + dd);
			} else {
				const startMs = this.civilToMs(this.civil(o.startMs) + delta);
				p = this.timedProposal(startMs, startMs + (o.endMs - o.startMs));
			}
			p.rowId = hit.rowId;
			return p;
		}
		if (hit.kind === "allDay") {
			if (o.allDay) {
				const dd = hit.day - (grab.kind === "allDay" || grab.kind === "day" ? grab.day : hit.day);
				return this.dayProposal(o.startDay + dd, o.endDay + dd);
			}
			return this.dayProposal(hit.day, hit.day + this.opts.defaultAllDayDays);
		}
		if (hit.kind === "day") {
			const dd = hit.day - (grab.kind === "day" ? grab.day : hit.day);
			if (o.allDay) return this.dayProposal(o.startDay + dd, o.startDay + dd + days);
			const startMs = this.civilToMs(this.civil(o.startMs) + dd * MINUTES_PER_DAY);
			const endMs = this.civilToMs(this.civil(o.endMs) + dd * MINUTES_PER_DAY);
			return this.timedProposal(startMs, endMs);
		}
		// Time grid
		const snap = this.slot.snap;
		if (o.allDay || grab.kind !== "time") {
			const c = Math.floor((hit.day * MINUTES_PER_DAY + hit.minute) / snap) * snap;
			const startMs = this.civilToMs(c);
			return this.timedProposal(startMs, this.civilToMs(c + this.opts.defaultTimedMinutes));
		}
		const delta = Math.round((this.hitCivil(hit) - this.hitCivil(grab)) / snap) * snap;
		const startCivil = this.civil(o.startMs) + delta;
		const startMs = this.civilToMs(startCivil);
		return this.timedProposal(startMs, startMs + (o.endMs - o.startMs));
	}

	private resizeProposal(o: NormalizedItem<D>, hit: Hit, fromStart: boolean): Proposal | null {
		if (o.allDay || hit.kind === "allDay" || hit.kind === "day") {
			if (hit.kind === "time") return null;
			const pointerDay = hit.kind === "timeline" ? Math.round(this.hitCivil(hit) / MINUTES_PER_DAY) : fromStart ? hit.day : hit.day + 1;
			if (!o.allDay) {
				// Timed item in a day grid: change the end day, keep the end time.
				const end = wallTime(o.endMs - 1, this.zone);
				const dd = (fromStart ? 0 : pointerDay - 1) - end.day;
				if (fromStart) return null;
				const endMs = Math.max(o.startMs + 60_000 * this.slot.snap, this.civilToMs(this.civil(o.endMs) + dd * MINUTES_PER_DAY));
				return this.timedProposal(o.startMs, endMs);
			}
			const p = fromStart
				? this.dayProposal(Math.min(o.endDay - 1, pointerDay), o.endDay)
				: this.dayProposal(o.startDay, Math.max(o.startDay + 1, pointerDay));
			if (hit.kind === "timeline") p.rowId = this.opts.timeline?.rowOf(o.item) ?? undefined;
			return p;
		}
		const snap = hit.kind === "timeline" ? this.timelineSnap() : this.slot.snap;
		const c = Math.round(this.hitCivil(hit) / snap) * snap;
		const ms = this.civilToMs(c);
		const min = snap * 60_000;
		const p = fromStart ? this.timedProposal(Math.min(ms, o.endMs - min), o.endMs) : this.timedProposal(o.startMs, Math.max(ms, o.startMs + min));
		if (hit.kind === "timeline") p.rowId = this.opts.timeline?.rowOf(o.item) ?? undefined;
		return p;
	}

	private withProposal(o: NormalizedItem<D>, p: Proposal): CalendarItem<D> {
		return {
			...o.item,
			start: p.allDay ? formatDay(p.startDay) : p.startMs,
			end: p.allDay ? formatDay(p.endDay) : p.endMs,
			allDay: p.allDay,
			rev: `drag:${o.sig}`,
		};
	}

	private selectionFor(a: Hit, b: Hit): Selection | null {
		if (a.kind !== b.kind) {
			if (!(a.kind === "allDay" && b.kind === "time") && !(a.kind === "time" && b.kind === "allDay")) return null;
			b = a.kind === "allDay" ? { kind: "allDay", day: b.day } : { kind: "time", day: b.day, minute: a.minute };
		}
		if (a.kind === "time" || (a.kind === "timeline" && this.timelineSnap() < MINUTES_PER_DAY)) {
			const snap = a.kind === "time" ? this.slot.snap : this.timelineSnap();
			const ca = Math.floor(this.hitCivil(a) / snap) * snap;
			const cb = Math.floor(this.hitCivil(b) / snap) * snap;
			const startMs = this.civilToMs(Math.min(ca, cb));
			const endMs = this.civilToMs(Math.max(ca, cb) + snap);
			const sel: Selection = { ...this.timedProposal(startMs, endMs) };
			if (a.kind === "timeline") sel.rowId = a.rowId;
			return sel;
		}
		const da = a.day;
		const db = b.day;
		const sel: Selection = this.dayProposal(Math.min(da, db), Math.max(da, db) + 1);
		if (a.kind === "timeline") sel.rowId = a.rowId;
		return sel;
	}

	private clickSlot(hit: Hit, ev: PointerEvent, touch: boolean): void {
		const day = hit.day;
		this.opts.onDateClick?.({ ...this.dayArg(day), jsEvent: ev });
		if (touch || !this.opts.selectable) return;
		const sel =
			hit.kind === "time"
				? (() => {
						const c = Math.floor(this.hitCivil(hit) / this.slot.duration) * this.slot.duration;
						return this.timedProposal(this.civilToMs(c), this.civilToMs(c + this.slot.duration));
					})()
				: this.selectionFor(hit, hit);
		if (!sel) return;
		this.selection = sel;
		this.current?.showSelection(sel);
		this.fireSelect(sel, ev);
	}

	private fireSelect(sel: Selection, ev: PointerEvent | KeyboardEvent | null): void {
		this.opts.onSelect?.({
			start: new Date(sel.startMs),
			end: new Date(sel.endMs),
			allDay: sel.allDay,
			startStr: sel.allDay ? formatDay(sel.startDay) : formatFloating(sel.startMs, this.zone),
			endStr: sel.allDay ? formatDay(sel.endDay) : formatFloating(sel.endMs, this.zone),
			jsEvent: ev,
			view: this.view,
			rowId: sel.rowId,
		});
	}

	private unselectSilently(): void {
		this.selection = null;
		this.current?.showSelection(null);
	}

	/** Ends the current pointer session, committing unless `cancel`. */
	private endSession(ev: PointerEvent | null, cancel: boolean): void {
		const s = this.session;
		if (!s) return;
		this.session = null;
		if (s.timer !== null) this.win.clearTimeout(s.timer);
		this.listenDoc(false);
		this.root.classList.remove(
			"tnc-dragging",
			"tnc-drop-denied",
			"tnc-dragging-move",
			"tnc-dragging-resize-end",
			"tnc-dragging-resize-start",
			"tnc-dragging-select",
			"tnc-dragging-external",
		);
		const draggedId = this.draggingId;
		this.draggingId = null;
		this.dragRow = null;
		if (draggedId) for (const el of this.elementsFor(draggedId)) el.classList.remove("is-dragging");
		if (!s.active) return;

		if (s.mode === "select") {
			if (cancel) this.unselectSilently();
			else if (this.selection) this.fireSelect(this.selection, ev);
			return;
		}
		if (s.mode === "external") {
			const p = s.proposal;
			if (p) this.applyChange(this.store.remove([EXTERNAL_ID]));
			if (cancel || !p || s.denied || !ev) return;
			this.flush();
			this.opts.onExternalDrop?.({
				start: new Date(p.startMs),
				end: new Date(p.endMs),
				allDay: p.allDay,
				startStr: p.allDay ? formatDay(p.startDay) : formatFloating(p.startMs, this.zone),
				endStr: p.allDay ? formatDay(p.endDay) : formatFloating(p.endMs, this.zone),
				jsEvent: ev,
				view: this.view,
				rowId: p.rowId,
				source: s.source ?? null,
				dataTransfer: null,
			});
			return;
		}
		const origin = s.origin!;
		const p = s.proposal;
		const revert = () => {
			const cur = this.store.get(origin.id);
			if (cur && cur.sig !== origin.sig) this.applyChange(this.store.upsert([origin.item]));
			this.flush();
		};
		if (cancel || s.denied || !p) {
			revert();
			return;
		}
		const changed = p.startMs !== origin.startMs || p.endMs !== origin.endMs || p.allDay !== origin.allDay || (p.rowId !== undefined && p.rowId !== this.opts.timeline?.rowOf(origin.item));
		if (!changed) {
			revert();
			return;
		}
		this.flush();
		this.commit(s.mode === "move" ? "drop" : "resize", origin, p, ev, revert);
	}

	private commit(
		kind: "drop" | "resize",
		origin: NormalizedItem<D>,
		p: Proposal,
		ev: PointerEvent | KeyboardEvent | null,
		revert: () => void,
	): void {
		const arg: ItemChangeArg<D> = {
			item: origin.item,
			start: new Date(p.startMs),
			end: new Date(p.endMs),
			allDay: p.allDay,
			startStr: p.allDay ? formatDay(p.startDay) : formatFloating(p.startMs, this.zone),
			endStr: p.allDay ? formatDay(p.endDay) : formatFloating(p.endMs, this.zone),
			oldStart: new Date(origin.startMs),
			oldEnd: new Date(origin.endMs),
			oldAllDay: origin.allDay,
			delta: p.startMs - origin.startMs,
			rowId: p.rowId,
			jsEvent: ev,
			source: ev && "key" in ev ? "keyboard" : "pointer",
			view: this.view,
			revert,
		};
		const handler = kind === "drop" ? this.opts.onItemDrop : this.opts.onItemResize;
		try {
			const res: unknown = handler?.(arg);
			if (res && typeof (res as PromiseLike<unknown>).then === "function") {
				Promise.resolve(res).catch(() => revert());
			}
		} catch (err) {
			revert();
			throw err;
		}
	}

	/* --------------------------------------------------------- click / keys */

	private readonly onClick = (ev: MouseEvent) => {
		if (this.suppressClick) {
			this.suppressClick = false;
			ev.stopPropagation();
			return;
		}
		const el = this.itemElFrom(ev.target);
		if (!el || (ev.target as Element).closest(".tnc-resize, .tnc-port")) return;
		const meta = this.meta.get(el)!;
		if (meta.n.id === EXTERNAL_ID) return;
		this.opts.onItemClick?.({ ...this.itemArg(el, meta), jsEvent: ev });
	};

	private readonly onDblClick = (ev: MouseEvent) => {
		const el = this.itemElFrom(ev.target);
		if (!el) return;
		const meta = this.meta.get(el)!;
		this.opts.onItemDoubleClick?.({ ...this.itemArg(el, meta), jsEvent: ev });
	};

	private readonly onContextMenu = (ev: MouseEvent) => {
		const el = this.itemElFrom(ev.target);
		if (!el) return;
		if (this.session?.active) {
			ev.preventDefault();
			return;
		}
		if (!this.opts.onItemContextMenu) return;
		ev.preventDefault();
		const meta = this.meta.get(el)!;
		this.opts.onItemContextMenu({ ...this.itemArg(el, meta), jsEvent: ev });
	};

	private hoverId: string | null = null;

	private readonly onMouseOver = (ev: MouseEvent) => {
		const el = this.itemElFrom(ev.target);
		const id = el ? this.meta.get(el)!.n.id : null;
		if (id === this.hoverId) return;
		this.leaveHover(ev);
		if (!el || !id || this.session?.active) return;
		this.hoverId = id;
		for (const other of this.elementsFor(id)) other.classList.add("is-hover");
		this.opts.onItemHover?.({ ...this.itemArg(el, this.meta.get(el)!), jsEvent: ev, entering: true });
	};

	private readonly onMouseOut = (ev: MouseEvent) => {
		const to = ev.relatedTarget as Element | null;
		const toEl = to ? this.itemElFrom(to) : null;
		if (toEl && this.meta.get(toEl)?.n.id === this.hoverId) return;
		this.leaveHover(ev);
	};

	private leaveHover(ev: MouseEvent): void {
		const id = this.hoverId;
		if (!id) return;
		this.hoverId = null;
		const els = this.elementsFor(id);
		for (const el of els) el.classList.remove("is-hover");
		const el = els[0];
		const meta = el ? this.meta.get(el) : undefined;
		if (el && meta) this.opts.onItemHover?.({ ...this.itemArg(el, meta), jsEvent: ev, entering: false });
	}

	private readonly onKeyDown = (ev: KeyboardEvent) => {
		if (ev.key === "Escape" && this.popover) {
			ev.preventDefault();
			ev.stopPropagation();
			this.closeMore(true);
			return;
		}
		const el = this.itemElFrom(ev.target);
		if (!el || ev.target !== el) return;
		const meta = this.meta.get(el)!;
		if (ev.key === "Enter" || ev.key === " ") {
			ev.preventDefault();
			this.opts.onItemClick?.({ ...this.itemArg(el, meta), jsEvent: ev });
			return;
		}
		if (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey)) {
			ev.preventDefault();
			this.opts.onItemContextMenu?.({ ...this.itemArg(el, meta), jsEvent: ev });
			return;
		}
		if (ev.altKey && ev.key.startsWith("Arrow")) {
			ev.preventDefault();
			this.nudge(meta.n.id, ev);
		}
	};

	/** Alt+Arrow moves an item; Alt+Shift+Arrow changes its end. */
	private nudge(id: string, ev: KeyboardEvent): void {
		const o = this.store.get(id);
		if (!o) return;
		const resize = ev.shiftKey;
		if (!this.isEditable(o, resize ? "duration" : "start")) return;
		const view = this.opts.view;
		const timeStep = view === "timeline" ? this.timelineSnap() : this.slot.snap;
		let dMin = 0;
		switch (ev.key) {
			case "ArrowLeft":
				dMin = view === "timeline" ? -Math.max(timeStep, o.allDay ? MINUTES_PER_DAY : 0) : -MINUTES_PER_DAY;
				break;
			case "ArrowRight":
				dMin = view === "timeline" ? Math.max(timeStep, o.allDay ? MINUTES_PER_DAY : 0) : MINUTES_PER_DAY;
				break;
			case "ArrowUp":
				dMin = view === "month" ? -7 * MINUTES_PER_DAY : o.allDay ? 0 : -timeStep;
				break;
			case "ArrowDown":
				dMin = view === "month" ? 7 * MINUTES_PER_DAY : o.allDay ? 0 : timeStep;
				break;
		}
		if (!dMin) return;
		let p: Proposal;
		if (o.allDay) {
			const dd = Math.round(dMin / MINUTES_PER_DAY);
			if (!dd) return;
			p = resize ? this.dayProposal(o.startDay, Math.max(o.startDay + 1, o.endDay + dd)) : this.dayProposal(o.startDay + dd, o.endDay + dd);
		} else if (resize) {
			p = this.timedProposal(o.startMs, Math.max(o.startMs + timeStep * 60_000, this.civilToMs(this.civil(o.endMs) + dMin)));
		} else {
			const startMs = this.civilToMs(this.civil(o.startMs) + dMin);
			p = this.timedProposal(startMs, startMs + (o.endMs - o.startMs));
		}
		const allowed = this.opts.canDrop?.({ item: o.item, start: new Date(p.startMs), end: new Date(p.endMs), allDay: p.allDay }) ?? true;
		if (!allowed) return;
		const revert = () => {
			this.applyChange(this.store.upsert([o.item]));
			this.flush();
		};
		this.applyChange(this.store.upsert([this.withProposal(o, p)]));
		this.flush();
		this.elementsFor(id)[0]?.focus();
		this.commit(resize ? "resize" : "drop", o, p, ev, revert);
	}

	/* ---------------------------------------------------------- native drop */

	private readonly onNativeDragOver = (ev: DragEvent) => {
		const dt = ev.dataTransfer;
		if (!dt || !this.opts.acceptNativeDrop?.(dt) || !this.current) return;
		ev.preventDefault();
		dt.dropEffect = "copy";
		const hit = this.current.hit(ev.clientX, ev.clientY);
		if (!hit) return;
		const sel = this.selectionFor(hit, hit);
		if (!sel) return;
		this.selection = sel;
		this.current.showSelection(sel);
	};

	private readonly onNativeDragLeave = (ev: DragEvent) => {
		if (ev.relatedTarget && this.root.contains(ev.relatedTarget as Node)) return;
		this.unselectSilently();
	};

	private readonly onNativeDrop = (ev: DragEvent) => {
		const dt = ev.dataTransfer;
		if (!dt || !this.opts.acceptNativeDrop?.(dt) || !this.current) return;
		ev.preventDefault();
		const hit = this.current.hit(ev.clientX, ev.clientY);
		this.unselectSilently();
		if (!hit) return;
		const sel = this.selectionFor(hit, hit);
		if (!sel) return;
		this.opts.onExternalDrop?.({
			start: new Date(sel.startMs),
			end: new Date(sel.endMs),
			allDay: sel.allDay,
			startStr: sel.allDay ? formatDay(sel.startDay) : formatFloating(sel.startMs, this.zone),
			endStr: sel.allDay ? formatDay(sel.endDay) : formatFloating(sel.endMs, this.zone),
			jsEvent: null,
			view: this.view,
			rowId: sel.rowId,
			source: null,
			dataTransfer: dt,
		});
	};
}

