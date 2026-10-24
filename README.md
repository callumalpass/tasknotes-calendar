# @tasknotes/calendar

A task-native calendar engine for TaskNotes: week/day/N-day time grid, month, list, year and timeline views, with incremental rendering, DST-safe drag arithmetic and popout-window support. No runtime dependencies.

## Usage

```ts
import { Calendar } from "@tasknotes/calendar";
import "@tasknotes/calendar/calendar.css";

const calendar = new Calendar(el, {
	view: "week",
	timeZone: "local",
	editable: true,
	onItemDrop: ({ item, startStr, endStr, revert }) => save(item.id, startStr, endStr).catch(revert),
});
calendar.setItems([{ id: "t1", title: "Plan sprint", start: "2026-10-21T10:00", end: "2026-10-21T11:30" }]);
```

- **Items** take `start`/`end` as `YYYY-MM-DD` (all-day) or `YYYY-MM-DDTHH:mm` (floating, read in the calendar's zone), ISO strings with an offset, or epoch ms. `end` is exclusive. Optional fields: `allDay`, `color`, `kind`, `lane` (`"plan"`/`"actual"`), `display: "background"`, `completed`, `dependsOn`, `rev` (cheap change signature), `data`.
- **Updates** are incremental: `setItems` diffs against the previous set, and `upsertItems`/`removeItems` re-render only the days touched. Render hooks (`itemDidMount`, …) fire only for elements that actually change.
- **Changes** (`onItemDrop`, `onItemResize`, `onSelect`, `onExternalDrop`) report TaskNotes storage strings (`startStr`/`endStr`), `revert()`, and `source: "pointer" | "keyboard"`. Returning a rejected promise reverts.
- **Input**: mouse drag after 4px, touch long press (`longPressDelay`), keyboard (Enter/Space, Shift+F10, Alt+Arrow to move, Alt+Shift+Arrow to resize), external drags via `beginExternalDrag` or native HTML5 drops.
- **Popouts**: all listeners, timers and observers use the host element's `ownerDocument`; bare `window`/`document` are lint errors in `src`.

### Timeline

`view: "timeline"` draws one row per `timeline.rows` entry (`rowOf(item)` picks the row) with bars, milestones (`kind: "milestone"`) and dependency arrows (`timeline.dependencies`).

- **Scale**: `timeline.scale = { unit, dayWidth | unitWidth, snapMinutes }`. `dayWidth` sets pixels per day directly; `unit` then only chooses the header ticks. `TIMELINE_UNIT_DAYS` is the days-per-unit table used to turn `unitWidth` into a day width.
- **Dependencies**: `dependsOn` takes ids (finish-to-start) or `{ id, type: "FS" | "SS" | "FF" | "SF" }`. Arrows leave and enter the edges the type names, and `dependencyConflicts` (also `dependencySatisfied`, `itemDependencies`, `dependencyType` in core) checks those edges.
- **Linking**: with `timeline.onLink`, bars get start and finish link handles (a milestone has one). Dragging from a handle to another bar's handle, or to its body (nearer edge; a milestone's body is its start), calls `onLink({ from, to, fromEdge, toEdge, type })`. `canLink` returns `false` or a reason to refuse a target live, and `onLinkDrag` reports `start`/`over`/`end` phases for feedback. On touch, handles show on the bar in `selected` (44px hit areas) and on every bar while linking.
- **Selection**: the `selected` option (id or ids) marks bars `is-selected` without a rebuild.
- **Hit testing**: `calendar.hitTest(x, y)` returns `{ kind: "timeline", day, minute, rowId, area, overTrack }` where `area` is `"track"`, `"header"`, `"label"` or `"outside"` (inside the chart but past the rows or range), and null outside the chart. External drags (`beginExternalDrag`) drop on rows, group headings and the date header; `onExternalDrop` carries the `hit`, and `onExternalDragEnd({ source, dropped, hit })` fires for every external drag, dropped or not.
- **Scrolling and zoom**: `calendar.scrollToDate(date, { align: "start" | "center" | "end", smooth })`. In the timeline, `setOptions` keeps what is on screen when `date`, range or scale change (a scale change keeps the middle of the visible track); `setOptions(next, { anchor: { clientX } })` keeps the instant under the pointer instead, e.g. for Ctrl+wheel zoom.
- **Row labels**: `rowLabelDidMount({ row, el })` / `rowLabelWillUnmount` hand you each label cell to fill (React portals work); rows compare by value, so unchanged rows keep their cells, and a rows-only change re-renders in place. The click that ends a drag is swallowed in the capture phase, before it reaches content in the calendar.
- **Small bars**: bars under 28px hide their title; under 20px they drop their resize grips and get a wider hit area so they still move and tap.
- **Keyboard**: `resizeHandleLabel({ item, edge })` makes the grips focusable buttons; Left/Right on a focused grip moves that edge by the snap. `todayLabel` labels the today line.

`@tasknotes/calendar/core` exposes the DOM-free parts (zones, store, layout, ordering, planning helpers) and `@tasknotes/calendar/react` a thin `TaskCalendar` wrapper.

### TaskNotes Bases settings

`basesLayoutOptions(settings)` maps the settings stored by the TaskNotes plugin's Bases calendar view (`viewFromBases`/`viewToBases` translate the FullCalendar view names held in `.base` files) to calendar options, applying the plugin's normalisation so existing settings keep their meaning. See `docs/integration/plugin-bases-calendar-spec.md`.

## Development

```bash
npm install
npm run playground        # http://localhost:4187 — demo data, options form, event log
npm test                  # unit tests (vitest)
npm run test:browser      # Playwright: Chromium + touch (Pixel 7)
npm run lint && npm run typecheck
npm run build             # dist/esm, dist/types, dist/calendar.css
```

The playground reads URL parameters (`view`, `tz`, `locale`, `date`, `theme`, `stress`, `height`, `capacity`) and exposes `window.tnc` for scripted checks.
