type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Creates an element in `doc` (popout windows have their own document). */
export function h<K extends keyof HTMLElementTagNameMap>(
	doc: Document,
	tag: K,
	cls?: string | null,
	attrs?: Attrs | null,
	...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
	const el = doc.createElement(tag);
	if (cls) el.className = cls;
	if (attrs) setAttrs(el, attrs);
	for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
	return el;
}

export function setAttrs(el: Element, attrs: Attrs): void {
	for (const [k, v] of Object.entries(attrs)) {
		if (v === null || v === undefined || v === false) el.removeAttribute(k);
		else el.setAttribute(k, v === true ? "" : String(v));
	}
}

export function classList(value: string[] | string | undefined | null): string[] {
	if (!value) return [];
	return (Array.isArray(value) ? value : value.split(/\s+/)).filter(Boolean);
}

export function setStyle(el: HTMLElement, props: Record<string, string | number | null>): void {
	for (const [k, v] of Object.entries(props)) {
		if (v === null) el.style.removeProperty(k);
		else el.style.setProperty(k, typeof v === "number" ? `${v}px` : v);
	}
}

export function pct(n: number): string {
	return `${Math.round(n * 10000) / 100}%`;
}
