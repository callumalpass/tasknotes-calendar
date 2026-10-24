import {
	basesLayoutOptions,
	type BasesCalendarLayout,
	BASES_CALENDAR_DEFAULTS,
	Calendar,
	type CalendarItem,
	type CalendarOptions,
	dayOf,
	formatDay,
	getTimeZone,
	type ItemChangeArg,
	type ViewType,
} from "../src/index";
import { type DemoData, demoItems, demoTimeline, UNSCHEDULED } from "./demo";

type Opts = Partial<CalendarOptions<DemoData>>;

const params = new URLSearchParams(location.search);
const zone = getTimeZone(params.get("tz") ?? "local");
const today = dayOf(Date.now(), zone);
const log: string[] = [];
const logEl = document.getElementById("log")!;
const perfEl = document.getElementById("perf")!;

function record(msg: string) {
	log.push(msg);
	const li = document.createElement("li");
	li.textContent = msg;
	logEl.prepend(li);
	while (logEl.children.length > 60) logEl.lastElementChild?.remove();
}

/* ----------------------------------------------------------------- data */

let calendarItems: CalendarItem<DemoData>[] = demoItems(today);
const timeline = demoTimeline(today);
let timelineItems = timeline.items;

const stress = Number(params.get("stress") ?? 0);
if (stress > 0) {
	for (let i = 0; i < stress; i++) {
		const day = today - 60 + Math.floor(Math.random() * 120);
		const minute = 6 * 60 + Math.floor(Math.random() * 56) * 15;
		const start = `${formatDay(day)}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
		calendarItems.push({ id: `stress-${i}`, title: `Stress ${i}`, start, end: null, kind: "task", color: "#7c5cf0", data: { kind: "task" } });
	}
}

/* -------------------------------------------------------------- options */

const layout: BasesCalendarLayout = {
	...BASES_CALENDAR_DEFAULTS,
	calendarView: params.get("view") ?? "timeGridWeek",
	firstDay: 1,
	slotMinTime: "06:00:00",
	slotMaxTime: "22:00:00",
	heightMode: params.get("height") === "auto" ? "auto" : "fill",
};
let playgroundView: ViewType | null = params.get("view") === "timeline" ? "timeline" : null;
let capacity = params.get("capacity") !== "0";
let selected: string | null = null;

function options(): Opts {
	const base = basesLayoutOptions<DemoData>(layout);
	return {
		...base,
		view: playgroundView ?? base.view,
		timeZone: params.get("tz") ?? "local",
		locale: params.get("locale") ?? base.locale,
		date: params.get("date") ?? undefined,
		capacityMinutes: capacity ? 6 * 60 : null,
		toolbar: { views: ["month", "week", "days", "day", "list", "year", "timeline"] },
		timeline: {
			rows: timeline.rows,
			rowOf: (item) => item.id,
			dependencies: true,
			days: 75,
			leadDays: 14,
			scale: { unit: "day", unitWidth: 34, snapMinutes: 1440 },
			todayLabel: "Today",
			resizeHandleLabel: ({ item, edge }) => `Change ${item.title} ${edge === "start" ? "start" : "end"}`,
			canLink: ({ from, to }) =>
				timelineItems.some((i) => i.id === from.id && i.dependsOn?.some((d) => (typeof d === "string" ? d : d.id) === to.id))
					? "That would create a cycle"
					: true,
			onLinkDrag: (arg) => {
				if (arg.phase === "end" && arg.to && !arg.valid) record(`link refused: ${arg.reason ?? "invalid"}`);
			},
			onLink: ({ from, to, type }) => {
				record(`link ${from.id} ${type} -> ${to.id}`);
				timelineItems = timelineItems.map((i) =>
					i.id === to.id ? { ...i, dependsOn: [...(i.dependsOn ?? []).filter((d) => (typeof d === "string" ? d : d.id) !== from.id), { id: from.id, type }] } : i,
				);
				syncItems();
			},
		},
		selected,
	};
}

/* ------------------------------------------------------------- calendar */

const host = document.getElementById("cal")!;
if (params.get("theme") === "dark") document.body.classList.add("dark");

function write(arg: ItemChangeArg<DemoData>, what: string): Promise<void> {
	const mods = arg.source === "pointer" && arg.jsEvent && (arg.jsEvent.ctrlKey || arg.jsEvent.metaKey || arg.jsEvent.altKey);
	record(`${what} ${arg.item.id} ${arg.startStr} → ${arg.endStr}${arg.allDay ? " (all-day)" : ""}${arg.rowId ? ` row=${arg.rowId}` : ""}${mods ? " +mod" : ""}`);
	// Simulate an async vault write.
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			if (arg.item.title.startsWith("FAIL")) {
				record(`write failed ${arg.item.id}`);
				reject(new Error("write failed"));
				return;
			}
			const update = (i: CalendarItem<DemoData>) =>
				i.id === arg.item.id ? { ...i, start: arg.startStr, end: arg.endStr, allDay: arg.allDay } : i;
			if (mods && arg.item.kind === "timeblock") {
				calendarItems = [...calendarItems, { ...arg.item, id: `${arg.item.id}-copy-${Date.now()}`, start: arg.startStr, end: arg.endStr }];
			} else if (calendar.getView().type === "timeline") {
				timelineItems = timelineItems.map(update);
			} else {
				calendarItems = calendarItems.map(update);
			}
			syncItems();
			resolve();
		}, 120);
	});
}

const calendar = new Calendar<DemoData>(host, {
	...options(),
	onItemDrop: (arg) => write(arg, "drop"),
	onItemResize: (arg) => write(arg, "resize"),
	onItemClick: ({ item }) => {
		record(`click ${item.id}`);
		selected = item.id;
		calendar.setOptions({ selected });
	},
	onItemDoubleClick: ({ item }) => record(`dblclick ${item.id}`),
	onItemContextMenu: ({ item }) => record(`contextmenu ${item.id}`),
	onSelect: (arg) => {
		record(`select ${arg.startStr} → ${arg.endStr}${arg.allDay ? " (all-day)" : ""}${arg.rowId ? ` row=${arg.rowId}` : ""}`);
		const minutes = (arg.end.getTime() - arg.start.getTime()) / 60_000;
		if (arg.allDay ? minutes > 1440 : minutes > 30 || arg.jsEvent?.altKey) {
			calendarItems = [
				...calendarItems,
				{ id: `new-${Date.now()}`, title: "New task", start: arg.startStr, end: arg.endStr, allDay: arg.allDay, kind: "task", color: "#7c5cf0", data: { kind: "task" } },
			];
			syncItems();
			calendar.unselect();
		}
	},
	onDateClick: (arg) => record(`dateclick ${arg.dateStr}`),
	onRangeChange: (view) => {
		record(`range ${view.type} ${formatDay(view.range.startDay)} → ${formatDay(view.range.endDay)}`);
		syncItems();
	},
	onViewChange: (view) => {
		playgroundView = view.type === "timeline" ? "timeline" : null;
		if (view.type !== "timeline") layout.calendarView = { month: "dayGridMonth", week: "timeGridWeek", days: "timeGridCustom", day: "timeGridDay", list: "listWeek", year: "multiMonthYear" }[view.type as "week"];
		renderForm();
	},
	onExternalDrop: (arg) => {
		const title = arg.source?.title ?? "Dropped";
		const area = arg.hit?.kind === "timeline" ? ` area=${arg.hit.area}` : "";
		record(`external ${title} ${arg.startStr} → ${arg.endStr}${arg.rowId ? ` row=${arg.rowId}` : ""}${area}`);
		unscheduled = unscheduled.filter((u) => u.title !== title);
		renderTray();
		calendarItems = [
			...calendarItems,
			{ id: `ext-${Date.now()}`, title, start: arg.startStr, end: arg.endStr, allDay: arg.allDay, kind: "task", color: arg.source?.color, data: { kind: "task" } },
		];
		syncItems();
	},
	onExternalDragEnd: ({ source, dropped }) => {
		if (!dropped) record(`external ${source.title} not dropped`);
	},
	itemDidMount: ({ el, item }) => {
		if (item.kind === "task") el.dataset.taskPath = `Tasks/${item.title}.md`;
	},
});

let ready = false;
function syncItems() {
	if (!ready) return;
	const t0 = performance.now();
	calendar.setItems(calendar.getView().type === "timeline" ? timelineItems : calendarItems);
	calendar.flush();
	perfEl.textContent = `${(performance.now() - t0).toFixed(1)} ms · ${calendar.store.size} items`;
}
ready = true;
syncItems();

/* ----------------------------------------------------------------- tray */

let unscheduled = [...UNSCHEDULED];
const tray = document.getElementById("tray")!;
function renderTray() {
	tray.replaceChildren(
		...unscheduled.map((u) => {
			const card = document.createElement("div");
			card.className = "card";
			card.style.setProperty("--c", u.color);
			card.dataset.title = u.title;
			card.innerHTML = `${u.title}<small>${u.durationMinutes} min</small>`;
			card.addEventListener("pointerdown", (ev) => {
				ev.preventDefault();
				calendar.beginExternalDrag(ev, { title: u.title, durationMinutes: u.durationMinutes, color: u.color, kind: "task" });
			});
			return card;
		}),
	);
}
renderTray();

/* ----------------------------------------------------------------- form */

type Field = { key: keyof BasesCalendarLayout; type: "bool" | "num" | "text" | "select"; options?: string[] };
const FIELDS: Field[] = [
	{ key: "calendarView", type: "select", options: ["dayGridMonth", "timeGridWeek", "timeGridCustom", "timeGridDay", "listWeek", "multiMonthYear"] },
	{ key: "customDayCount", type: "num" },
	{ key: "listDayCount", type: "num" },
	{ key: "heightMode", type: "select", options: ["fill", "auto"] },
	{ key: "firstDay", type: "select", options: ["0", "1", "2", "3", "4", "5", "6"] },
	{ key: "timeFormat", type: "select", options: ["24", "12"] },
	{ key: "weekNumbers", type: "bool" },
	{ key: "showWeekends", type: "bool" },
	{ key: "showAllDaySlot", type: "bool" },
	{ key: "showTodayHighlight", type: "bool" },
	{ key: "todayColumnWidthMultiplier", type: "num" },
	{ key: "slotMinTime", type: "text" },
	{ key: "slotMaxTime", type: "text" },
	{ key: "slotDuration", type: "text" },
	{ key: "snapDuration", type: "text" },
	{ key: "scrollTime", type: "text" },
	{ key: "nowIndicator", type: "bool" },
	{ key: "showTimeGrid", type: "bool" },
	{ key: "selectMirror", type: "bool" },
	{ key: "slotEventOverlap", type: "bool" },
	{ key: "eventMinHeight", type: "num" },
	{ key: "eventMaxStack", type: "num" },
	{ key: "dayMaxEvents", type: "num" },
	{ key: "dayMaxEventRows", type: "num" },
	{ key: "locale", type: "text" },
];

const form = document.getElementById("opts") as HTMLFormElement;
function renderForm() {
	form.replaceChildren();
	for (const f of FIELDS) {
		const id = `opt-${f.key}`;
		const label = document.createElement("label");
		label.htmlFor = id;
		label.textContent = f.key;
		let input: HTMLInputElement | HTMLSelectElement;
		const value = layout[f.key];
		if (f.type === "select") {
			const sel = document.createElement("select");
			for (const o of f.options!) sel.append(new Option(o, o, false, String(value) === o));
			input = sel;
		} else {
			const inp = document.createElement("input");
			inp.type = f.type === "bool" ? "checkbox" : f.type === "num" ? "number" : "text";
			if (f.type === "bool") inp.checked = value === true;
			else inp.value = value == null ? "" : String(value);
			input = inp;
		}
		input.id = id;
		input.name = f.key;
		input.addEventListener("change", () => {
			const v =
				f.type === "bool" ? (input as HTMLInputElement).checked : f.type === "num" ? Number(input.value) : input.value;
			(layout as Record<string, unknown>)[f.key] = v;
			if (f.key === "calendarView") playgroundView = null;
			record(`option ${f.key}=${String(v)}`);
			calendar.setOptions(options());
			syncItems();
		});
		form.append(label, input);
	}
	const capLabel = document.createElement("label");
	capLabel.textContent = "capacity (6h)";
	const cap = document.createElement("input");
	cap.type = "checkbox";
	cap.checked = capacity;
	cap.addEventListener("change", () => {
		capacity = cap.checked;
		calendar.setOptions(options());
	});
	form.append(capLabel, cap);
}
renderForm();

declare global {
	interface Window {
		tnc: {
			calendar: Calendar<DemoData>;
			log: string[];
			items: () => CalendarItem<DemoData>[];
			setItems: (items: CalendarItem<DemoData>[]) => void;
			setLayout: (patch: Partial<BasesCalendarLayout>) => void;
		};
	}
}
window.tnc = {
	calendar,
	log,
	items: () => (calendar.getView().type === "timeline" ? timelineItems : calendarItems),
	setItems: (items) => {
		calendarItems = items;
		syncItems();
	},
	setLayout: (patch) => {
		Object.assign(layout, patch);
		playgroundView = null;
		calendar.setOptions(options());
		syncItems();
		renderForm();
	},
};
