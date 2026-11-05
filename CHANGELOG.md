# Changelog

## Unreleased

## 0.1.7

### Added

- Hosts can read collision column counts and the unobscured timed content width, choose views responsively, fill an empty list through a content hook, and translate the stack label with the `appointments` text.

### Fixed

- Collision stacks show appointment counts and open only the matching collision group, without unrelated all-day or timed items. Narrow time grids reveal the selected day on entry and view changes, not only after Today.
- Crowded time-grid days use readable collision stacks without widening the entire week; stack contents retain drag-and-drop, including after moving the calendar into another window.
- Today reveals the current day horizontally, with persistent day navigation when the grid is wider than its pane.
- Overflow dialogs clamp to the visible viewport, reposition on resize and scroll, keep Close reachable, and provide touch-sized rows and keyboard navigation.
- Collision stacks honour `eventMaxStack`, and overflow triggers stay stable across rerenders, so Escape returns focus to them.

## 0.1.6

### Changed

- Time grids give tracked (`lane: "actual"`) items their narrow strip only where they overlap planned items. Elsewhere, planned and tracked items use the full column width, as before the side lane existed. The strip's width is the `--tnc-actual-w` custom property (default 22%).
  - Reported by @RumiaKitinari in [TaskNotes issue 2494](https://github.com/callumalpass/tasknotes/issues/2494) and @mgreen3 in [TaskNotes issue 2498](https://github.com/callumalpass/tasknotes/issues/2498).
- The toolbar's previous and next buttons draw their chevrons as icons, which are larger and clearer than the ‹ › glyphs.

## 0.1.5

### Added

- Host-managed `CalendarItem.preview` placements for group drags. They use mirror styling, are non-interactive and hidden from assistive navigation, and remain visible beyond month/all-day event limits and timed stack limits. Multiple overflow previews stack separately.
  - Supports the TaskNotes batch-scheduling workflow requested by @mnicolas94 in [Discussion 2435](https://github.com/callumalpass/tasknotes/discussions/2435), with the existing limitations clarified by @Thanatos9404.

### Fixed

- The dragged anchor remains visible when moving into a timed cluster limited by `eventMaxStack`.

## 0.1.4

### Added

- `dateStrip` puts the agenda's date strip above day, multi-day and week views. Picking a strip day moves the grid there, and items can be dropped on strip days.
- Agenda lists can show a lead section above the first day (`listLeadTitle`, `listLeadIncludes`, `listLeadDidMount`) and an add row under every day (`listAddText`, `onListAdd`).
- The strip shows a Today chip when it is away from today.
- `ViewInfo.dataRange` covers the days a strip shows past the visible range, so hosts can load items for every strip dot.

### Changed

- The date strip belongs to the calendar rather than the list, so it keeps its state (and any host controls in its slot) across navigation and view changes.

## 0.1.3

### Added

- `listAgenda` turns the list view into a phone-style agenda. A date strip sits above a list of every day, and more days load as you scroll. The strip shows a week, or the month after a tap on its title. It marks busy days and follows the day at the top of the list. Picking a strip day scrolls the list to it. Rows can be dragged onto another day or a strip day.

### Fixed

- On touch screens, a swipe that starts on a draggable item scrolls whatever actually scrolls. At `height: "auto"` that is the page, which these swipes did not scroll before.

## 0.1.2

### Changed

- Year views narrower than 520px (phones, sidebars) show two compact months a row. Days are shaded by how busy they are, with no dots, and any day with items is visibly shaded.

### Fixed

- Clicking or tapping a day in the year view reports it through `onDateClick`. Before, only Enter or Space on a focused day did.
- The calendar keeps its sticky headers and popovers in its own stacking context, so host overlays such as side sheets and dialogs draw above the week header and all-day row.

## 0.1.1

### Fixed

- Calendars moved into another window after creation (e.g. Obsidian "Move to new window") rebind their listeners, timers and observers to that window, so dragging, selection and resizing keep working. `adopt()` is also public for hosts that move a calendar programmatically.
- Time-grid day columns keep a minimum width (`--tnc-col-min`, 64px); narrow containers scroll sideways with the time axis pinned instead of crushing week views on phones.

## 0.1.0

Initial public release.

- DOM-free date, timezone, store, layout and planning primitives.
- Incremental DOM calendar: week/day/N-day, month (including dots), list, year and timeline views.
- Mouse, touch and keyboard item editing, render hooks, popout support and an optional React wrapper.
- TaskNotes Bases settings adapter preserving existing saved view names and layout settings.
- Scoped stylesheet with host theme variables; ESM, CommonJS and typed consumer entry points.
- Package installation checks, deterministic Chromium visual baselines and structural accessibility coverage.
