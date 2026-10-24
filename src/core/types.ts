import type { Day } from "./date";

export type DateInput = Date | string | number;

/**
 * One thing on the calendar. `end` is exclusive, as in FullCalendar and iCal:
 * an all-day item on the 3rd has start "2026-10-03", end "2026-10-04".
 */
export interface CalendarItem<D = unknown> {
	id: string;
	title: string;
	start: DateInput;
	end?: DateInput | null;
	/** Defaults to true for date-only `start` strings. */
	allDay?: boolean;
	/** Free-form kind used for styling and behaviour, e.g. "task", "event", "timeblock", "timeEntry". */
	kind?: string;
	/** Main colour. Background, border and text derive from it unless set. */
	color?: string;
	backgroundColor?: string;
	borderColor?: string;
	textColor?: string;
	className?: string | string[];
	/** Overrides the calendar-wide `editable` option. */
	editable?: boolean;
	startEditable?: boolean;
	durationEditable?: boolean;
	/** "background" items shade their time range without taking layout space. */
	display?: "auto" | "background" | "none";
	completed?: boolean;
	/** Ids of items that must finish before this one starts. */
	dependsOn?: string[];
	/** Time-grid lane. "actual" items (tracked time) sit in a narrow side lane. */
	lane?: "plan" | "actual";
	/** Items sharing a groupId move together when one is dragged. */
	groupId?: string;
	/** Change token. When set, the store compares it instead of serialising the item. */
	rev?: string | number;
	data?: D;
}

/** An item resolved against the calendar's time zone. */
export interface NormalizedItem<D = unknown> {
	readonly id: string;
	readonly item: CalendarItem<D>;
	readonly allDay: boolean;
	/** Instants (ms). For all-day items these are the zone's midnights. */
	readonly startMs: number;
	readonly endMs: number;
	/** Civil days, end exclusive. */
	readonly startDay: Day;
	readonly endDay: Day;
	readonly sig: string;
}

export interface DateRange {
	/** First visible day. */
	startDay: Day;
	/** Day after the last visible day. */
	endDay: Day;
	start: Date;
	end: Date;
}
