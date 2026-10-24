import { type CalendarItem, formatDay, parseDay, startOfWeek, type TimelineRow } from "../src/index";

export interface DemoData {
	kind: "task" | "due" | "span" | "event" | "timeblock" | "timeEntry" | "recurring" | "focus";
	priority?: "high" | "normal" | "low";
	project?: string;
}

const PRIORITY = { high: "#e5484d", normal: "#7c5cf0", low: "#2f9e6e" } as const;

const pad = (n: number) => String(n).padStart(2, "0");
const at = (day: number, hh: number, mm = 0) => `${formatDay(day)}T${pad(hh)}:${pad(mm)}`;

/** A realistic week of TaskNotes data around `today`, covering every event kind. */
export function demoItems(today: number): CalendarItem<DemoData>[] {
	const mon = startOfWeek(today, 1);
	const items: CalendarItem<DemoData>[] = [];
	let n = 0;
	const task = (title: string, start: string, end: string | null, priority: "high" | "normal" | "low" = "normal", extra: Partial<CalendarItem<DemoData>> = {}) => {
		items.push({
			id: `scheduled-${++n}`,
			title,
			start,
			end,
			kind: "task",
			color: PRIORITY[priority],
			data: { kind: "task", priority, project: extra.data?.project },
			...extra,
		});
	};
	task("Write release notes", at(mon, 9), at(mon, 10, 30), "high");
	task("Review calendar PR", at(mon, 11), at(mon, 12));
	task("Inbox zero", at(mon, 16), at(mon, 16, 30), "low");
	task("Plan sprint", at(mon + 1, 10), at(mon + 1, 11, 30), "high");
	task("Pair on DST bug", at(mon + 1, 10, 30), at(mon + 1, 12));
	task("Fix flaky test", at(mon + 1, 11), at(mon + 1, 11, 45), "high");
	task("Update docs", at(mon + 2, 14), at(mon + 2, 15, 30), "low", { completed: true });
	task("Design review", at(mon + 3, 13), at(mon + 3, 14));
	task("Ship beta", at(mon + 4, 15), at(mon + 4, 16), "high");
	task("Database migration", at(mon + 2, 22, 30), at(mon + 3, 1, 15), "high");
	task("Quarterly planning", formatDay(mon + 1), formatDay(mon + 4), "normal", { allDay: true });
	task("Conference", formatDay(mon + 3), formatDay(mon + 6), "low", { allDay: true });
	task("Water plants", formatDay(mon + 2), null, "low", { allDay: true });

	// Due markers (TaskNotes "due" events: timed ones are 30 min).
	items.push(
		{ id: "due-1", title: "Invoice due", start: at(mon + 2, 17), end: at(mon + 2, 17, 30), kind: "due", color: "#d97706", editable: true, data: { kind: "due" } },
		{ id: "due-2", title: "Grant report due", start: formatDay(mon + 4), allDay: true, kind: "due", color: "#d97706", data: { kind: "due" } },
	);
	// Scheduled → due span.
	items.push({
		id: "span-1",
		title: "Website redesign",
		start: formatDay(mon),
		end: formatDay(mon + 3),
		allDay: true,
		kind: "span",
		color: "#0a9bb8",
		data: { kind: "span" },
	});
	// Calendar events (ICS read-only, Google editable).
	items.push(
		{ id: "ics-1", title: "Team standup", start: at(mon, 9, 30), end: at(mon, 9, 45), kind: "event", color: "#3788d8", editable: false, data: { kind: "event" } },
		{ id: "ics-2", title: "Team standup", start: at(mon + 1, 9, 30), end: at(mon + 1, 9, 45), kind: "event", color: "#3788d8", editable: false, data: { kind: "event" } },
		{ id: "ics-3", title: "Team standup", start: at(mon + 2, 9, 30), end: at(mon + 2, 9, 45), kind: "event", color: "#3788d8", editable: false, data: { kind: "event" } },
		{ id: "google-1", title: "1:1 with Sam", start: at(mon + 2, 11), end: at(mon + 2, 11, 30), kind: "event", color: "#4285F4", data: { kind: "event" } },
		{ id: "google-2", title: "Dentist", start: at(mon + 4, 8), end: at(mon + 4, 9), kind: "event", color: "#4285F4", data: { kind: "event" } },
		{ id: "ics-4", title: "Public holiday", start: formatDay(mon + 5), allDay: true, kind: "event", color: "#3788d8", editable: false, data: { kind: "event" } },
	);
	// Timeblocks.
	items.push(
		{ id: "timeblock-1", title: "Deep work", start: at(mon + 1, 13), end: at(mon + 1, 15), kind: "timeblock", color: "#6366f1", data: { kind: "timeblock" } },
		{ id: "timeblock-2", title: "Admin", start: at(mon + 3, 16), end: at(mon + 3, 17), kind: "timeblock", color: "#6366f1", data: { kind: "timeblock" } },
	);
	// Time entries (actual lane).
	items.push(
		{ id: "timeentry-1", title: "Write release notes", start: at(mon, 9, 5), end: at(mon, 10, 50), kind: "timeEntry", lane: "actual", color: "#16a34a", data: { kind: "timeEntry" } },
		{ id: "timeentry-2", title: "Plan sprint", start: at(mon + 1, 10, 15), end: at(mon + 1, 11, 10), kind: "timeEntry", lane: "actual", color: "#16a34a", data: { kind: "timeEntry" } },
	);
	// Recurring pattern instances.
	for (let i = 0; i < 5; i++) {
		items.push({
			id: `recurring-gym-${formatDay(mon + i)}`,
			title: "Gym",
			start: at(mon + i, 7),
			end: at(mon + i, 8),
			kind: "recurring",
			color: "#2f9e6e",
			completed: mon + i < today,
			data: { kind: "recurring" },
		});
	}
	// Background focus hours.
	items.push({ id: "focus-1", title: "Focus", start: at(mon + 3, 9), end: at(mon + 3, 12), display: "background", color: "#7c5cf0", data: { kind: "focus" } });
	// A busy day for "+N more".
	for (let i = 0; i < 6; i++) {
		items.push({ id: `busy-${i}`, title: `Errand ${i + 1}`, start: formatDay(mon + 2), allDay: true, kind: "task", color: PRIORITY.low, data: { kind: "task" } });
	}
	return items;
}

export const UNSCHEDULED = [
	{ title: "Call the bank", durationMinutes: 30, color: PRIORITY.normal },
	{ title: "Draft blog post", durationMinutes: 90, color: PRIORITY.high },
	{ title: "Order printer ink", durationMinutes: 15, color: PRIORITY.low },
	{ title: "Read RFC", durationMinutes: 60, color: PRIORITY.normal },
];

/** Projects and tasks for the timeline view, with dependencies. */
export function demoTimeline(today: number): { rows: TimelineRow[]; items: CalendarItem<DemoData>[] } {
	const rows: TimelineRow[] = [];
	const items: CalendarItem<DemoData>[] = [];
	const projects = [
		{ id: "p-web", title: "Website redesign", color: "#0a9bb8" },
		{ id: "p-app", title: "Mobile app 2.0", color: "#7c5cf0" },
	];
	let offset = -6;
	for (const p of projects) {
		rows.push({ id: p.id, title: p.title, group: true, color: p.color });
		const tasks = [
			["Research", 4],
			["Wireframes", 5],
			["Visual design", 7],
			["Build", 10],
			["QA", 4],
		] as const;
		let prev: string | null = null;
		let start = today + offset;
		for (const [title, len] of tasks) {
			const id = `${p.id}-${title.toLowerCase().replace(/\s+/g, "-")}`;
			rows.push({ id, title, depth: 1, color: p.color });
			items.push({
				id,
				title,
				start: formatDay(start),
				end: formatDay(start + len),
				allDay: true,
				color: p.color,
				dependsOn: prev ? [prev] : [],
				completed: start + len <= today,
				data: { kind: "task", project: p.id },
			});
			prev = id;
			start += len;
		}
		const launch = `${p.id}-launch`;
		rows.push({ id: launch, title: "Launch", depth: 1, color: p.color });
		items.push({ id: launch, title: "Launch", start: formatDay(start + 1), allDay: true, kind: "milestone", color: p.color, dependsOn: [prev!], data: { kind: "due", project: p.id } });
		offset += 9;
	}
	// One deliberate conflict: QA starts before Build ends.
	const qa = items.find((i) => i.id === "p-app-qa");
	if (qa) {
		const s0 = parseDay(String(qa.start))! - 3;
		qa.start = formatDay(s0);
		qa.end = formatDay(s0 + 4);
	}
	return { rows, items };
}
