import type { CalendarOptions, ViewType } from "../dom/options";

/** View names stored in `.base` files (FullCalendar's names, kept for compatibility). */
export type BasesCalendarViewName = "dayGridMonth" | "timeGridWeek" | "timeGridCustom" | "timeGridDay" | "listWeek" | "multiMonthYear";

const FROM_BASES: Record<BasesCalendarViewName, ViewType> = {
	dayGridMonth: "month",
	timeGridWeek: "week",
	timeGridCustom: "days",
	timeGridDay: "day",
	listWeek: "list",
	multiMonthYear: "year",
};

const TO_BASES: Partial<Record<ViewType, BasesCalendarViewName>> = {
	month: "dayGridMonth",
	week: "timeGridWeek",
	days: "timeGridCustom",
	day: "timeGridDay",
	list: "listWeek",
	year: "multiMonthYear",
};

export function viewFromBases(name: string | null | undefined, fallback: ViewType = "month"): ViewType {
	return (name && FROM_BASES[name as BasesCalendarViewName]) || fallback;
}

export function viewToBases(view: ViewType): BasesCalendarViewName | null {
	return TO_BASES[view] ?? null;
}

/**
 * Layout settings of the TaskNotes calendar Bases view, as stored in `.base`
 * files (event toggles and data settings are not layout and are not here).
 */
export interface BasesCalendarLayout {
	calendarView?: string | null;
	customDayCount?: number | null;
	listDayCount?: number | null;
	heightMode?: string | null;
	firstDay?: string | number | null;
	timeFormat?: string | null;
	weekNumbers?: boolean | null;
	showWeekends?: boolean | null;
	showAllDaySlot?: boolean | null;
	showTodayHighlight?: boolean | null;
	todayColumnWidthMultiplier?: number | null;
	slotMinTime?: string | null;
	slotMaxTime?: string | null;
	slotDuration?: string | null;
	snapDuration?: string | null;
	scrollTime?: string | null;
	nowIndicator?: boolean | null;
	showTimeGrid?: boolean | null;
	selectMirror?: boolean | null;
	slotEventOverlap?: boolean | null;
	eventMinHeight?: number | null;
	eventMaxStack?: number | null;
	dayMaxEvents?: number | boolean | null;
	dayMaxEventRows?: number | boolean | null;
	locale?: string | null;
}

/** Defaults used by TaskNotes when a key is absent. */
export const BASES_CALENDAR_DEFAULTS: Required<{ [K in keyof BasesCalendarLayout]: NonNullable<BasesCalendarLayout[K]> }> = {
	calendarView: "dayGridMonth",
	customDayCount: 3,
	listDayCount: 7,
	heightMode: "fill",
	firstDay: 1,
	timeFormat: "24",
	weekNumbers: false,
	showWeekends: true,
	showAllDaySlot: true,
	showTodayHighlight: true,
	todayColumnWidthMultiplier: 1,
	slotMinTime: "00:00:00",
	slotMaxTime: "24:00:00",
	slotDuration: "00:30:00",
	snapDuration: "00:30:00",
	scrollTime: "08:00:00",
	nowIndicator: true,
	showTimeGrid: true,
	selectMirror: true,
	slotEventOverlap: true,
	eventMinHeight: 15,
	eventMaxStack: 0,
	dayMaxEvents: 0,
	dayMaxEventRows: 0,
	locale: "",
};

const num = (v: unknown, fallback: number): number => {
	const n = typeof v === "string" ? Number(v) : v;
	return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** "HH:MM[:SS]" check with the same limits TaskNotes enforces. */
export function isValidSlotTime(value: string, maxHours = 23): boolean {
	const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
	if (!m) return false;
	const hh = Number(m[1]);
	const mm = Number(m[2]);
	const ss = Number(m[3] ?? 0);
	if (mm > 59 || ss > 59 || hh > maxHours) return false;
	if (hh === 48 && (mm || ss)) return false;
	return true;
}

/**
 * Converts Bases calendar settings to calendar options, applying the same
 * normalisation the FullCalendar-based view did, so existing `.base` files
 * keep their behaviour.
 */
export function basesLayoutOptions<D>(
	s: BasesCalendarLayout,
	context: { embedded?: boolean } = {},
): Partial<CalendarOptions<D>> {
	const d = BASES_CALENDAR_DEFAULTS;
	const pick = <K extends keyof BasesCalendarLayout>(k: K) => (s[k] ?? d[k]) as NonNullable<BasesCalendarLayout[K]>;
	const view = viewFromBases(pick("calendarView"));
	const showTimeGrid = pick("showTimeGrid") !== false;
	const time = (k: "slotMinTime" | "slotMaxTime" | "slotDuration" | "snapDuration" | "scrollTime", max = 23) => {
		const v = s[k];
		return typeof v === "string" && isValidSlotTime(v, max) ? v : undefined;
	};
	let today = num(s.todayColumnWidthMultiplier, 1);
	today = today < 1 || today > 5 ? 1 : Math.round(today * 2) / 2;

	const rawMax = s.dayMaxEvents ?? d.dayMaxEvents;
	let dayMaxEvents: boolean | number = typeof rawMax === "boolean" ? rawMax : num(rawMax, 0) === 0 ? true : clamp(num(rawMax, 0), 1, 20);
	if (!showTimeGrid && dayMaxEvents === true && view !== "month") dayMaxEvents = false;
	const rawRows = s.dayMaxEventRows ?? d.dayMaxEventRows;
	const dayMaxEventRows = typeof rawRows === "boolean" ? 0 : clamp(num(rawRows, 0), 0, 10);
	const slotDuration = time("slotDuration") ?? d.slotDuration;
	const locale = (s.locale ?? "").trim();

	const out: Partial<CalendarOptions<D>> = {
		view,
		dayCount: clamp(Math.round(num(s.customDayCount, d.customDayCount)), 1, 14),
		listDayCount: clamp(Math.round(num(s.listDayCount, d.listDayCount)), 1, 365),
		// The plugin overrode FullCalendar's listWeek with `duration: { days: listDayCount }`,
		// which aligns to the day (not the week), so saved list views start at the date.
		listStart: "date",
		height: context.embedded || s.heightMode === "auto" ? "auto" : "fill",
		expandRows: !(context.embedded || s.heightMode === "auto"),
		firstDay: clamp(Math.round(num(s.firstDay, 1)), 0, 6),
		hour12: (s.timeFormat ?? d.timeFormat) === "12",
		weekNumbers: pick("weekNumbers") === true,
		weekends: pick("showWeekends") !== false,
		allDaySlot: pick("showAllDaySlot") !== false,
		todayHighlight: pick("showTodayHighlight") !== false,
		todayWidth: view === "week" || view === "days" ? today : 1,
		slotMinTime: time("slotMinTime") ?? d.slotMinTime,
		slotMaxTime: time("slotMaxTime", 48) ?? d.slotMaxTime,
		slotDuration,
		snapDuration: time("snapDuration") ?? slotDuration,
		scrollTime: time("scrollTime", 48) ?? d.scrollTime,
		nowIndicator: pick("nowIndicator") !== false,
		timeGrid: showTimeGrid,
		selectMirror: pick("selectMirror") !== false,
		slotEventOverlap: pick("slotEventOverlap") !== false,
		eventMinHeight: clamp(num(s.eventMinHeight, d.eventMinHeight), 15, 100),
		eventMaxStack: clamp(Math.round(num(s.eventMaxStack, 0)), 0, 10),
		dayMaxEvents,
		dayMaxEventRows,
	};
	if (locale) out.locale = locale;
	return out;
}
