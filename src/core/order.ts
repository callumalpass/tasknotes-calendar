import type { ItemOrder } from "./layout";
import type { NormalizedItem } from "./types";

type Field = (n: NormalizedItem) => unknown;

const BUILTIN: Record<string, Field> = {
	start: (n) => n.startMs,
	end: (n) => n.endMs,
	duration: (n) => n.endMs - n.startMs,
	allDay: (n) => (n.allDay ? 0 : 1),
	title: (n) => n.item.title,
	id: (n) => n.id,
};

function compare(a: unknown, b: unknown): number {
	if (a === b) return 0;
	if (a == null) return 1;
	if (b == null) return -1;
	if (typeof a === "number" && typeof b === "number") return a - b;
	const str = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v) ?? "");
	return str(a).localeCompare(str(b));
}

/**
 * Parses a FullCalendar-style order string such as
 * `"start,-duration,allDay,title"`. Unknown fields are read from the item, then
 * from `item.data`. `allDay` sorts all-day items first, as FullCalendar does.
 */
export function parseOrder<D = unknown>(spec: string | ItemOrder<D> | undefined): ItemOrder<D> {
	if (typeof spec === "function") return spec;
	const parts = (spec ?? "start,-duration,allDay,title")
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => {
			const desc = p.startsWith("-");
			const name = desc ? p.slice(1) : p;
			const field: Field =
				BUILTIN[name] ??
				((n) => {
					const own = (n.item as unknown as Record<string, unknown>)[name];
					if (own !== undefined) return own;
					const data = n.item.data;
					return data && typeof data === "object" ? (data as Record<string, unknown>)[name] : undefined;
				});
			return { field, sign: desc ? -1 : 1 };
		});
	return (a, b) => {
		for (const { field, sign } of parts) {
			const c = compare(field(a), field(b));
			if (c) return c * sign;
		}
		return 0;
	};
}
