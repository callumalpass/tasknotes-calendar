import type { Day } from "../core/date";
import type { ItemOrder } from "../core/layout";
import type { CalendarItem, DateInput, DateRange, DependencyType } from "../core/types";

/**
 * How an item element is drawn: "timed" (time-grid block), "bar" (all-day or
 * multi-day bar), "dot" (timed item in a day cell), "indicator" (a dot in a
 * `monthDisplay: "dots"` cell), "list" (list-view row) or "timeline" (timeline bar).
 */
export type ItemVariant = "timed" | "bar" | "dot" | "indicator" | "list" | "timeline";

export type ViewType = "week" | "day" | "days" | "month" | "list" | "year" | "timeline";

export interface ViewInfo {
	type: ViewType;
	range: DateRange;
	/** Anchor date the view was built around. */
	anchor: Day;
	title: string;
}

/** Where a pointer is over the calendar. */
export type Hit =
	| { kind: "time"; day: Day; minute: number }
	| { kind: "allDay"; day: Day }
	| { kind: "day"; day: Day }
	| {
			kind: "timeline";
			/** Row under the pointer (group rows included); null over the header, or below the last row. */
			rowId: string | null;
			day: Day;
			minute: number;
			area: TimelineArea;
			/** Over a non-group row's track: where an item can be placed in a row. */
			overTrack: boolean;
	  };

/**
 * Part of the timeline under the pointer. "outside" is inside the chart but
 * past the rows or the date range; points outside the chart hit nothing.
 */
export type TimelineArea = "track" | "header" | "label" | "outside";

export interface ItemArg<D> {
	item: CalendarItem<D>;
	el: HTMLElement;
	view: ViewInfo;
	/** Day this element represents (items crossing midnight have one element per day). */
	day: Day;
	isStart: boolean;
	isEnd: boolean;
	isMirror: boolean;
	variant: ItemVariant;
	/**
	 * Time label in the calendar's locale and hour format: "9am – 10:30am" for
	 * timed, list and timeline items; the start ("9am") for bars and dots, and
	 * only on the day the item starts. Empty for all-day items.
	 */
	timeText: string;
}

export interface ItemPointerArg<D> extends ItemArg<D> {
	jsEvent: MouseEvent | KeyboardEvent;
}

export interface ItemChangeArg<D> {
	item: CalendarItem<D>;
	start: Date;
	end: Date;
	allDay: boolean;
	/** `start` / `end` as stored by TaskNotes: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" in the calendar zone. */
	startStr: string;
	endStr: string;
	oldStart: Date;
	oldEnd: Date;
	oldAllDay: boolean;
	/** Change in start, in ms. */
	delta: number;
	/** Row the item was dropped on (timeline view). */
	rowId?: string;
	jsEvent: PointerEvent | KeyboardEvent | null;
	/** How the change was made. Modifier keys only mean "copy" for pointer drops. */
	source: "pointer" | "keyboard";
	view: ViewInfo;
	/** Puts the item back where it was. Called automatically if the handler's promise rejects. */
	revert: () => void;
}

export interface SelectArg {
	start: Date;
	end: Date;
	allDay: boolean;
	startStr: string;
	endStr: string;
	jsEvent: PointerEvent | KeyboardEvent | null;
	view: ViewInfo;
	rowId?: string;
}

export interface ExternalDragSource<D = unknown> {
	title: string;
	/** Defaults to `defaultTimedMinutes`. */
	durationMinutes?: number;
	color?: string;
	kind?: string;
	data?: D;
}

export interface ExternalDropArg<D> extends SelectArg {
	source: ExternalDragSource<D> | null;
	/** Where the drop landed; in the timeline this says whether it was over a row, a heading or the date header. */
	hit: Hit | null;
	/** Set for native (HTML5) drops. */
	dataTransfer: DataTransfer | null;
}

export interface DayArg {
	date: Date;
	day: Day;
	dateStr: string;
	view: ViewInfo;
	isToday: boolean;
	isPast: boolean;
}

export interface DateClickArg extends DayArg {
	/** Wall-clock minute of the clicked slot, snapped to `slotDuration`; null for day cells and the all-day row. */
	minute: number | null;
	allDay: boolean;
	/** "YYYY-MM-DD" for all-day clicks, "YYYY-MM-DDTHH:mm" for slots. */
	startStr: string;
	jsEvent: MouseEvent | KeyboardEvent;
}

export interface DayHeaderArg extends DayArg {
	el: HTMLElement;
}

export interface MoreArg<D> {
	day: Day;
	date: Date;
	items: CalendarItem<D>[];
	hidden: CalendarItem<D>[];
	jsEvent: MouseEvent | KeyboardEvent;
	el: HTMLElement;
	view: ViewInfo;
}

export interface TimelineRow {
	id: string;
	title: string;
	/** Indent level for nested rows. */
	depth?: number;
	/** Group rows are headings and do not take drops. */
	group?: boolean;
	color?: string;
	collapsed?: boolean;
}

export interface TimelineScale {
	/** Width of one `unit` in px. */
	unitWidth: number;
	/** Width of one day in px. Overrides `unitWidth`; the unit then only picks the header ticks. */
	dayWidth?: number;
	unit: "hour" | "day" | "week" | "month" | "quarter";
	/** Drag snap in minutes. */
	snapMinutes: number;
}

/** Days in one timeline scale unit, used to turn `unitWidth` into a day width. */
export const TIMELINE_UNIT_DAYS: Readonly<Record<TimelineScale["unit"], number>> = {
	hour: 1 / 24,
	day: 1,
	week: 7,
	month: 30.44,
	quarter: 91.31,
};

export type LinkEdge = "start" | "finish";

export interface LinkArg<D> {
	from: CalendarItem<D>;
	to: CalendarItem<D>;
	fromEdge: LinkEdge;
	toEdge: LinkEdge;
	/** `fromEdge` and `toEdge` as a relationship type. */
	type: DependencyType;
}

/** A link drag in progress. `to` is the bar or link handle under the pointer. */
export interface LinkDragArg<D> {
	phase: "start" | "over" | "end";
	from: CalendarItem<D>;
	fromEdge: LinkEdge;
	to: CalendarItem<D> | null;
	toEdge: LinkEdge | null;
	type: DependencyType | null;
	/** False when `canLink` refused the target. */
	valid: boolean;
	/** Reason returned by `canLink`. */
	reason: string | null;
	/** On "end": whether `onLink` fired. */
	linked: boolean;
}

export interface TimelineRowArg {
	row: TimelineRow;
	/** The row's label cell. Content placed here is yours until `rowLabelWillUnmount`. */
	el: HTMLElement;
}

export interface TimelineOptions<D> {
	rows: TimelineRow[];
	/** Row an item is drawn in. Items without a row are not drawn. */
	rowOf: (item: CalendarItem<D>) => string | null | undefined;
	scale?: Partial<TimelineScale>;
	/** Days shown, starting at the anchor. Default 120. */
	days?: number;
	/** Days before the anchor to show. Default 14. */
	leadDays?: number;
	labelWidth?: number;
	rowHeight?: number;
	/** Draw `dependsOn` arrows. */
	dependencies?: boolean;
	/** Fills a row label. Prefer `rowLabelDidMount`, which pairs with `rowLabelWillUnmount`. */
	rowContent?: (row: TimelineRow, el: HTMLElement) => void;
	/**
	 * A row's label cell was created. Mount your content (a React portal, say)
	 * into `el`; the calendar leaves it alone and suppresses the click that ends
	 * a drag before it reaches listeners inside.
	 */
	rowLabelDidMount?: (arg: TimelineRowArg) => void;
	/** A row's label cell is about to be removed. */
	rowLabelWillUnmount?: (arg: TimelineRowArg) => void;
	/**
	 * Fires when the user drags from a bar's start or finish handle to another
	 * bar. Dropping on a handle picks that edge; dropping on the bar picks the
	 * nearer edge (a milestone's body counts as its start).
	 */
	onLink?: (arg: LinkArg<D>) => void;
	/** Return false or a reason to refuse a link target while dragging. */
	canLink?: (arg: LinkArg<D>) => boolean | string;
	/** Reports a link drag as it starts, changes target and ends. */
	onLinkDrag?: (arg: LinkDragArg<D>) => void;
	/** Label shown on the today line, e.g. "Today". */
	todayLabel?: string;
	/**
	 * Makes bar resize handles focusable buttons with this label. Arrow keys on a
	 * focused handle move that edge by the snap.
	 */
	resizeHandleLabel?: (arg: { item: CalendarItem<D>; edge: LinkEdge }) => string;
	onRowClick?: (row: TimelineRow, jsEvent: MouseEvent) => void;
}

/**
 * Pins a timeline instant to a screen position across `setOptions`: the
 * instant under `clientX`, or `date` at `clientX` (or where `date` is now).
 */
export type TimelineAnchor = { clientX: number; date?: DateInput } | { date: DateInput; clientX?: number };

export interface ToolbarButton {
	id: string;
	text: string;
	hint?: string;
	icon?: () => Node;
	onClick: (ev: MouseEvent) => void;
}

export interface ToolbarOptions {
	/** View buttons, in order. */
	views?: ViewType[];
	extraButtons?: ToolbarButton[];
	/** Extra buttons go before prev/next ("start") or after the view buttons ("end"). */
	extraPlacement?: "start" | "end";
}

export interface CalendarText {
	today: string;
	prev: string;
	next: string;
	allDay: string;
	noItems: string;
	more: (n: number) => string;
	/** Day-cell label suffix in `monthDisplay: "dots"`. */
	itemCount: (n: number) => string;
	weekNumber: (n: number) => string;
	views: Partial<Record<ViewType, string>>;
	viewHints: Partial<Record<ViewType, string>>;
}

export interface CalendarOptions<D = unknown> {
	view: ViewType;
	/** Date the view is built around. */
	date: DateInput;
	/** Columns for the "days" view. */
	dayCount: number;
	/** Days in the "list" view. */
	listDayCount: number;
	/**
	 * Where the "list" view starts: at the date ("date", FullCalendar's
	 * `duration: { days: n }` lists, as the TaskNotes plugin used), or at the
	 * start of its week ("week", like FullCalendar's stock `listWeek`).
	 */
	listStart: "date" | "week";
	/**
	 * Turns the "list" view into a phone-style agenda: a date strip (one week,
	 * or the month when expanded) above a list of every day, empty ones
	 * included, that loads more days as it nears its end. The strip marks the
	 * day at the top of the list, picking a day scrolls to it, and items
	 * dragged onto a strip day or another day's section move there.
	 */
	listAgenda: boolean;
	/**
	 * Month cells: "full" draws bars and titled entries; "dots" draws every
	 * item as a small dot that wraps across the cell, with a "+N" count when
	 * they do not fit (`dayMaxEvents` caps the dots). In "dots" the day cell is
	 * the tap target: dots ignore the pointer and are hidden from assistive
	 * technology, and the cell is labelled with its item count.
	 */
	monthDisplay: "full" | "dots";
	/** "local" or an IANA name. */
	timeZone: string;
	locale: string | undefined;
	/** 0 = Sunday. Defaults to the locale's first day. */
	firstDay: number | undefined;
	/** undefined = locale default. */
	hour12: boolean | undefined;
	weekNumbers: boolean;
	weekends: boolean;
	hiddenDays: number[];
	allDaySlot: boolean;
	/** False hides the timed part of time-grid views, leaving the all-day row. */
	timeGrid: boolean;
	todayHighlight: boolean;
	/** Width of today's column relative to other columns (week and days views). */
	todayWidth: number;
	slotMinTime: string | number;
	slotMaxTime: string | number;
	slotDuration: string | number;
	snapDuration: string | number | undefined;
	scrollTime: string | number;
	/** Pixel height of one slot. */
	slotHeight: number;
	/** Stretch slots to fill the available height ("fill" mode only). */
	expandRows: boolean;
	nowIndicator: boolean;
	selectMirror: boolean;
	slotEventOverlap: boolean;
	/** Minimum item height in px in time grids. */
	eventMinHeight: number;
	/** Max side-by-side items in a time-grid cluster before "+N". 0 = unlimited. */
	eventMaxStack: number;
	/** Day cells: true = as many as fit, number = max items, false = unlimited. */
	dayMaxEvents: boolean | number;
	/** Day cells: max rows including the "+N more" link. 0 = unlimited. */
	dayMaxEventRows: number;
	eventOrder: string | ItemOrder<D>;
	/** "fill" takes the host's height and scrolls inside; "auto" grows with content. */
	height: "fill" | "auto";
	editable: boolean;
	selectable: boolean;
	navLinks: boolean;
	resizableFromStart: boolean;
	longPressDelay: number;
	defaultTimedMinutes: number;
	defaultAllDayDays: number;
	/** Shows a bar per day of planned minutes against this capacity. */
	capacityMinutes: number | ((day: Day) => number) | null;
	/** Draw due-style milestones and dependency warnings. */
	planning: boolean;
	toolbar: boolean | ToolbarOptions;
	text: Partial<CalendarText>;
	timeline: TimelineOptions<D> | null;
	/** Accept native HTML5 drops (e.g. files). */
	acceptNativeDrop: ((dt: DataTransfer) => boolean) | null;
	/** Ids of selected items: they get `is-selected`, and in the timeline show their link handles on touch. */
	selected: string | readonly string[] | null;

	/* callbacks */
	onRangeChange?: (view: ViewInfo) => void;
	onViewChange?: (view: ViewInfo) => void;
	onItemClick?: (arg: ItemPointerArg<D>) => void;
	onItemDoubleClick?: (arg: ItemPointerArg<D>) => void;
	onItemContextMenu?: (arg: ItemPointerArg<D>) => void;
	onItemHover?: (arg: ItemPointerArg<D> & { entering: boolean }) => void;
	onItemDrop?: (arg: ItemChangeArg<D>) => void | Promise<unknown>;
	onItemResize?: (arg: ItemChangeArg<D>) => void | Promise<unknown>;
	/** Return false to forbid a drop target. */
	canDrop?: (arg: { item: CalendarItem<D>; start: Date; end: Date; allDay: boolean; rowId?: string }) => boolean;
	onSelect?: (arg: SelectArg) => void;
	onUnselect?: () => void;
	/** A tap or click on a day cell, the all-day row or a time slot (without dragging). */
	onDateClick?: (arg: DateClickArg) => void;
	/** Date links: day headers and numbers (`target: "day"`), year-view month titles (`"month"`). Default switches to that view. */
	onNavLink?: (arg: DayArg & { target: "day" | "month"; jsEvent: MouseEvent | KeyboardEvent }) => void;
	onExternalDrop?: (arg: ExternalDropArg<D>) => void;
	/** Fires when a `beginExternalDrag` drag ends, dropped or not. */
	onExternalDragEnd?: (arg: { source: ExternalDragSource<D>; dropped: boolean; hit: Hit | null; jsEvent: PointerEvent | null }) => void;
	/** Return false to skip the built-in popover. */
	onMoreClick?: (arg: MoreArg<D>) => boolean | void;

	/* render hooks (indicators in `monthDisplay: "dots"` get class names and mount hooks, not content) */
	itemContent?: (arg: ItemArg<D>) => Node | string | null | undefined;
	itemClassNames?: (arg: ItemArg<D>) => string[] | string | undefined;
	itemDidMount?: (arg: ItemArg<D>) => void;
	itemWillUnmount?: (arg: ItemArg<D>) => void;
	/** Replaces a list-view row's content. */
	listItemContent?: (arg: ItemArg<D>) => Node | null | undefined;
	dayHeaderContent?: (arg: DayArg) => Node | string | null | undefined;
	dayHeaderDidMount?: (arg: DayHeaderArg) => void;
	dayClassNames?: (arg: DayArg) => string[] | string | undefined;
}

export const DEFAULT_TEXT: CalendarText = {
	today: "Today",
	prev: "Previous",
	next: "Next",
	allDay: "All day",
	noItems: "Nothing scheduled",
	more: (n) => `+${n} more`,
	itemCount: (n) => (n === 1 ? "1 item" : `${n} items`),
	weekNumber: (n) => `W${n}`,
	views: { week: "Week", day: "Day", days: "Days", month: "Month", list: "List", year: "Year", timeline: "Timeline" },
	viewHints: {},
};

export function defaultOptions<D>(): CalendarOptions<D> {
	return {
		view: "week",
		date: Date.now(),
		dayCount: 3,
		listDayCount: 7,
		listStart: "date",
		listAgenda: false,
		monthDisplay: "full",
		timeZone: "local",
		locale: undefined,
		firstDay: undefined,
		hour12: undefined,
		weekNumbers: false,
		weekends: true,
		hiddenDays: [],
		allDaySlot: true,
		timeGrid: true,
		todayHighlight: true,
		todayWidth: 1,
		slotMinTime: "00:00",
		slotMaxTime: "24:00",
		slotDuration: "00:30",
		snapDuration: undefined,
		scrollTime: "08:00",
		slotHeight: 24,
		expandRows: false,
		nowIndicator: true,
		selectMirror: true,
		slotEventOverlap: true,
		eventMinHeight: 15,
		eventMaxStack: 0,
		dayMaxEvents: true,
		dayMaxEventRows: 0,
		eventOrder: "start,-duration,allDay,title",
		height: "fill",
		editable: true,
		selectable: true,
		navLinks: true,
		resizableFromStart: false,
		longPressDelay: 350,
		defaultTimedMinutes: 60,
		defaultAllDayDays: 1,
		capacityMinutes: null,
		planning: false,
		toolbar: true,
		text: {},
		timeline: null,
		acceptNativeDrop: null,
		selected: null,
	};
}

/** Options keys that require a full view rebuild rather than an item refresh. */
export const LAYOUT_KEYS = new Set<keyof CalendarOptions>([
	"view",
	"dayCount",
	"listDayCount",
	"listStart",
	"listAgenda",
	"monthDisplay",
	"timeZone",
	"locale",
	"firstDay",
	"hour12",
	"weekNumbers",
	"weekends",
	"hiddenDays",
	"allDaySlot",
	"timeGrid",
	"todayHighlight",
	"todayWidth",
	"slotMinTime",
	"slotMaxTime",
	"slotDuration",
	"snapDuration",
	"slotHeight",
	"expandRows",
	"nowIndicator",
	"slotEventOverlap",
	"eventMinHeight",
	"eventMaxStack",
	"dayMaxEvents",
	"dayMaxEventRows",
	"eventOrder",
	"height",
	"capacityMinutes",
	"planning",
	"toolbar",
	"text",
	"timeline",
	"editable",
	"itemContent",
	"itemClassNames",
	"listItemContent",
	"dayHeaderContent",
	"dayClassNames",
]);
