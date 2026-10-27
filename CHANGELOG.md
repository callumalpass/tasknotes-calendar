# Changelog

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
