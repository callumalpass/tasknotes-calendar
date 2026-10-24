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
