# Changelog

## Unreleased

- Time-grid day columns keep a minimum width (`--tnc-col-min`, 64px); narrow containers scroll sideways with the time axis pinned instead of crushing week views on phones.

## 0.1.0

Initial public release.

- DOM-free date, timezone, store, layout and planning primitives.
- Incremental DOM calendar: week/day/N-day, month (including dots), list, year and timeline views.
- Mouse, touch and keyboard item editing, render hooks, popout support and an optional React wrapper.
- TaskNotes Bases settings adapter preserving existing saved view names and layout settings.
- Scoped stylesheet with host theme variables; ESM, CommonJS and typed consumer entry points.
- Package installation checks, deterministic Chromium visual baselines and structural accessibility coverage.
