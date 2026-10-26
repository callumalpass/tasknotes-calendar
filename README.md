# @tasknotes/calendar

A task-native calendar engine for TaskNotes: week/day/N-day time grid, month, list, year and timeline views, with incremental rendering, DST-safe drag arithmetic and popout-window support. No runtime dependencies.

## Install

```bash
npm install @tasknotes/calendar
# Only for the optional React wrapper:
npm install react
```

ES modules and CommonJS (`require("@tasknotes/calendar")`) are supported.
Import the stylesheet once in your bundler. React 18+ is an optional peer; the
DOM and core entry points have no runtime dependencies. Use a modern browser
with CSS Grid, `color-mix()`, Pointer Events and `ResizeObserver`. Node 22+
is supported for tooling and DOM-free core use.

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
// On host/component teardown:
// calendar.destroy();
```

Give `el` a height (for example `height: 600px`) for the default
`height: "fill"`, or choose `height: "auto"` to grow with content.
The host persists changes; the calendar supplies optimistic updates and a
`revert()` function. Destroy the instance to release listeners and observers.

- **Items** take `start`/`end` as `YYYY-MM-DD` (all-day) or `YYYY-MM-DDTHH:mm` (floating, read in the calendar's zone), ISO strings with an offset, or epoch ms. `end` is exclusive. Optional fields: `allDay`, `color`, `kind`, `lane` (`"plan"`/`"actual"`), `display: "background"`, `completed`, `dependsOn`, `rev` (cheap change signature), `data`.
- **Updates** are incremental: `setItems` diffs against the previous set, and `upsertItems`/`removeItems` re-render only the days touched. Render hooks (`itemDidMount`, …) fire only for elements that actually change, but every callback's `item` is the object most recently passed in for that id, so `item.data` is never stale.
- **Render hooks** (`itemContent`, `itemClassNames`, `itemDidMount`, `itemWillUnmount`, `listItemContent`) get `variant` (`"timed"`, `"bar"`, `"dot"`, `"indicator"`, `"list"`, `"timeline"`) and `timeText`, the time label in the calendar's locale and hour format (`"9am – 10:30am"` for timed, list and timeline items, the start for bars and dots, empty for all-day items).
- **Drags** move the item itself with the pointer in every view (time grid, all-day row, month, timeline), for mouse and touch; the dragged item is never folded into "+N more".
- **Changes** (`onItemDrop`, `onItemResize`, `onSelect`, `onExternalDrop`) report TaskNotes storage strings (`startStr`/`endStr`), `revert()`, and `source: "pointer" | "keyboard"`. Returning a rejected promise reverts.
- **Clicks**: `onDateClick` reports `minute` (the slot's wall-clock minute, snapped to `slotDuration`; null for day cells and the all-day row), `allDay` and `startStr` (`"YYYY-MM-DD"` or `"YYYY-MM-DDTHH:mm"`), so a tap on a slot can prefill a time.
- **Input**: mouse drag after 4px, touch long press (`longPressDelay`), keyboard (Enter/Space, Shift+F10, Alt+Arrow to move, Alt+Shift+Arrow to resize), external drags via `beginExternalDrag` or native HTML5 drops.
- **Popouts**: all listeners, timers and observers use the host element's `ownerDocument`; bare `window`/`document` are lint errors in `src`.

### Views and options

| `view` | Layout |
| --- | --- |
| `"week"` / `"day"` / `"days"` | Time grid; `dayCount` controls the N-day view |
| `"month"` | Month cells, full items or compact dots |
| `"list"` | Agenda for `listDayCount` days (default 7) |
| `"year"` | Twelve mini-months with activity indicators |
| `"timeline"` | Resource/task rows with dependency bars |

Pass partial options to the constructor or `setOptions()`.
`changeView()`, `gotoDate()`, `prev()`, `next()` and `goToday()` control navigation.
Common options include `date`, `timeZone` (`"local"` or an IANA zone),
`locale`, `firstDay` (0–6), `hour12`, `weekends`, `hiddenDays`,
`weekNumbers`, `toolbar`, `editable`, `selectable`, `navLinks`,
`dayMaxEvents`, `slotMinTime`, `slotMaxTime`, `slotDuration`,
`snapDuration`, `scrollTime` and `nowIndicator`. The time grid defaults
to 00:00–24:00 in 30-minute slots, initially scrolled to 08:00.
`text` supplies translated labels; `itemContent` and related hooks supply
custom DOM. The exported `CalendarOptions<D>` type documents the full API.

### Month and list

- `monthDisplay: "dots"` draws every item in a month cell as a small dot (`--tnc-dot-size`, `--tnc-dot-gap`) that wraps across the cell, with "+N" when they do not fit; `dayMaxEvents` caps the dots (`false` lets cells grow). The day cell is the tap target: dots ignore the pointer, are `aria-hidden`, get no content hook, and the cell is labelled "<date>, N items" (`text.itemCount`). Items in dots have `variant: "indicator"`; colour them with `color` or `itemDidMount` setting `--tnc-c`.
- **"+N more" height**: day rows (and the time grid's all-day row) make room for the link at its rendered height, so a host may give it a 44px touch target (`--tnc-more-h`, or any min-height) without overflowing the row.
- `listStart: "date" | "week"`: the list view starts at the date (default; FullCalendar `duration: { days: n }` lists, as the TaskNotes plugin and app used) or at the start of its week (FullCalendar's stock `listWeek`); week-aligned lists step by whole weeks.

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

`basesLayoutOptions(settings)` maps the settings stored by the TaskNotes plugin's Bases calendar view (`viewFromBases`/`viewToBases` translate the FullCalendar view names held in `.base` files) to calendar options, applying the plugin's normalisation so existing settings keep their meaning. Saved `listWeek` views keep starting at the date (`listStart: "date"`): the plugin configured FullCalendar's list as `duration: { days: listDayCount }`, which aligns to the day, not the week. See `docs/integration/plugin-bases-calendar-spec.md`.

## Theming

Set `--tnc-theme-*` variables on the host (they inherit into the calendar)
or on `.tnc`. The stylesheet is scoped to `.tnc` and does not inject CSS.

```css
.my-calendar {
  --tnc-theme-bg: #181818;
  --tnc-theme-bg-2: #222;
  --tnc-theme-bg-3: #303030;
  --tnc-theme-text: #f5f5f5;
  --tnc-theme-muted: #bbb;
  --tnc-theme-faint: #aaa;
  --tnc-theme-line: #444;
  --tnc-theme-line-strong: #666;
  --tnc-theme-accent: #b6a3ff;
  --tnc-theme-accent-text: #181818;
}
```

Additional semantic colours: `--tnc-theme-now`, `--tnc-theme-warn`,
`--tnc-theme-ok`, `--tnc-theme-amber`. Item colours come from `color`,
`backgroundColor`, `borderColor` and `textColor`.
Override sizing tokens such as `--tnc-font-size`, `--tnc-small`,
`--tnc-radius`, `--tnc-bar-h`, `--tnc-more-h`, `--tnc-dot-size` and
`--tnc-dot-gap` directly on `.tnc` (not just its ancestor).

## Accessibility

Items are labelled, focusable buttons: Enter/Space activates, Shift+F10 opens
the host's context menu, Alt+Arrow moves, and Alt+Shift+Arrow resizes when
editing is allowed (the list and year views are read-only). Month dots and year days expose date/item-count labels;
Enter/Space invokes `onDateClick`. Dots are summaries, not individual item
controls. Time grid and timeline expose labelled tables; month exposes a grid.
Full arrow-key grid navigation, keyboard dependency linking and keyboard range
selection are not implemented. Hosts must provide alternatives for those actions.
Structural ARIA checks are not a full WCAG audit; verify contrast and custom hook
content in your own theme.

## Development

```bash
npm ci
npm run playground        # http://localhost:4187 — demo data, options form, event log
npm test                  # unit tests (vitest)
npm run test:browser      # Playwright: Chromium + touch (Pixel 7)
npm run lint && npm run typecheck
npm run build             # dist/esm, dist/cjs, dist/types, dist/calendar.css
npm run test:package      # pack/install; ESM, CJS, CSS, React and strict consumer types
```

Visual baselines and interaction tests use Chromium in the official
`mcr.microsoft.com/playwright:v1.64.1-noble` image, also used by CI. To run
the same environment locally (Docker required):

```bash
docker run --rm --ipc=host -v "$PWD:/work" -w /work \\
  -v /work/node_modules -e CI=true \\
  mcr.microsoft.com/playwright:v1.64.1-noble \\
  bash -lc 'npm ci && npm run test:browser'
```

Append `-- --update-snapshots` to the test command to regenerate baselines
**inside that image**, then review the PNGs before accepting them. Tests fix
the date, timezone, locale, viewport, colour scheme and motion preference.
Keep the image version and the exact `@playwright/test` pin in sync.

The playground reads URL parameters (`view`, `tz`, `locale`, `date`, `theme`, `stress`, `height`, `capacity`, `display=dots`, `listStart=week`) and exposes `window.tnc` for scripted checks.
