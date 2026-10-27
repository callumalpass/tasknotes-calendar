# Changelog

## Unreleased

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
