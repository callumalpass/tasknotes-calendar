import type { Day } from "../core/date";
import type { ItemOrder } from "../core/layout";
import type { CalendarItem, DateInput, DateRange } from "../core/types";

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
	| { kind: "timeline"; rowId: string; day: Day; minute: number };

export interface ItemArg<D> {
	item: CalendarItem<D>;
	el: HTMLElement;
	view: ViewInfo;
	/** Day this element represents (items crossing midnight have one element per day). */
	day: Day;
	isStart: boolean;
	isEnd: boolean;
	isMirror: boolean;
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
	revert(): void;
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
	unit: "hour" | "day" | "week" | "month" | "quarter";
	/** Drag snap in minutes. */
	snapMinutes: number;
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
	rowContent?: (row: TimelineRow, el: HTMLElement) => void;
	/** Fires when the user drags from one bar's link port to another. */
	onLink?: (arg: { from: CalendarItem<D>; to: CalendarItem<D> }) => void;
	onRowClick?: (row: TimelineRow, jsEvent: MouseEvent) => void;
}

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
	onDateClick?: (arg: DayArg & { jsEvent: MouseEvent | KeyboardEvent }) => void;
	/** Date links (day headers, day numbers). Default navigates to the day view. */
	onNavLink?: (arg: DayArg & { jsEvent: MouseEvent | KeyboardEvent }) => void;
	onExternalDrop?: (arg: ExternalDropArg<D>) => void;
	/** Return false to skip the built-in popover. */
	onMoreClick?: (arg: MoreArg<D>) => boolean | void;

	/* render hooks */
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
	};
}

/** Options keys that require a full view rebuild rather than an item refresh. */
export const LAYOUT_KEYS = new Set<keyof CalendarOptions>([
	"view",
	"dayCount",
	"listDayCount",
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
