import { type CSSProperties, useEffect, useLayoutEffect, useRef } from "react";
import type { CalendarItem } from "../core/types";
import { Calendar } from "../dom/calendar";
import type { CalendarOptions } from "../dom/options";

export interface TaskCalendarProps<D> extends Partial<CalendarOptions<D>> {
	items: readonly CalendarItem<D>[];
	className?: string;
	style?: CSSProperties;
	/** Receives the Calendar instance (null on unmount). */
	calendarRef?: (calendar: Calendar<D> | null) => void;
	/** Change to force a full re-render, e.g. when render hooks read new state. */
	renderKey?: unknown;
}

/**
 * React binding. Options are diffed by value, so inline callbacks and object
 * literals do not cause rebuilds; callbacks always see the latest props.
 */
export function TaskCalendar<D = unknown>(props: TaskCalendarProps<D>) {
	const { items, className, style, calendarRef, renderKey, ...options } = props;
	const host = useRef<HTMLDivElement>(null);
	const cal = useRef<Calendar<D> | null>(null);
	const refCb = useRef(calendarRef);
	refCb.current = calendarRef;

	useLayoutEffect(() => {
		const el = host.current;
		if (!el) return;
		const instance = new Calendar<D>(el, options, items);
		cal.current = instance;
		refCb.current?.(instance);
		return () => {
			refCb.current?.(null);
			instance.destroy();
			cal.current = null;
		};
		// The instance lives for the component's lifetime; later props flow through setOptions/setItems.
	}, []);

	useLayoutEffect(() => {
		cal.current?.setOptions(options);
	});

	useEffect(() => {
		cal.current?.setItems(items);
	}, [items]);

	const firstKey = useRef(true);
	useEffect(() => {
		if (firstKey.current) {
			firstKey.current = false;
			return;
		}
		cal.current?.rerender();
	}, [renderKey]);

	return <div ref={host} className={className} style={style} />;
}

export { Calendar };
export type { CalendarItem, CalendarOptions };
