# Bases calendar view (`tasknotesCalendar`): compatibility spec

Repo: `/home/calluma/projects/tasknotes` (main @ `98281173`), FullCalendar `^6.1.17` (core, daygrid, timegrid, list, interaction, multimonth). Unless a path is given, refs are to files under `src/bases/`.

**Things to know before reimplementing:**
- **Nothing can be dragged in from outside.** `droppable` is never set and there is no `eventReceive`. `src/utils/DragDropManager.ts` builds FullCalendar `Draggable`s, but nothing calls `makeTaskCardDraggable`.
- **No FullCalendar locale packs are imported** (no `@fullcalendar/core/locales`). The `locale` option only changes Intl date/time formatting. It does not translate anything or change week start.
- **Some settings are not read by this view:** `defaultShowDueWhenScheduled`, `defaultShowICSEvents` and `timeblockAttachmentSearchOrder` (the last is used by the timeblock modals instead).
- **`CalendarView.onDataUpdated` replaces the base class version** and never calls `updateRelevantPathsCache()`. The cache that filters task-update events is only filled in `onload` (`BasesViewBase.ts:176`).
- **Provider data changes do not refetch the view directly.** Google's `data-changed` goes through `plugin.notifyDataChanged` → `EVENT_DATA_CHANGED`, and no Bases view listens to that. New ICS/Google/Microsoft data appears on the next render/refetch, or when the user presses the refresh button.

---

## 1. Settings

### 1.1 Registration
- `registration.ts:85-93`: `registerBasesView(plugin, "tasknotesCalendar", { name: "TaskNotes Calendar", factory: buildCalendarViewFactory(plugin), options: (config) => buildCalendarViewOptions(plugin, config) })`.
- `BASES_CALENDAR_VIEW_ID = "tasknotesCalendar"` (`src/types.ts:15`).
- The factory (`CalendarView.ts:3154`) returns `new CalendarView(controller, containerEl, plugin)`. Bases sets `.data`, `.config` and `.app` after construction.
- Option values are read with `readBasesViewConfigValue(config, key)`. A value of `null`/`undefined` falls back to the default (`calendarConfigSnapshot.ts:77`, `calendarViewOptions.ts:23`).
- `CS` below means `plugin.settings.calendarViewSettings`.

### 1.2 Per-view options (key as stored in the `.base` file)
Defaults come from `calendarViewOptions.ts` (UI) and the `CalendarView.ts:553-608` constructor (runtime). They agree except where noted.

**Events group** (`calendarViewOptions.ts:135-227`)

| key | type | default | shown when | effect |
|---|---|---|---|---|
| `showScheduled` | toggle | `CS.defaultShowScheduled` (true) | always | Scheduled task events |
| `showDue` | toggle | `CS.defaultShowDue` (true) | always | Due task events |
| `showOverdueOnToday` | toggle | false | only when `calendarView === "listWeek"` (:163) | Overdue scheduled/due copies are also placed on today |
| `showScheduledToDueSpan` | toggle | `CS.defaultShowScheduledToDueSpan` (false) | only when showScheduled **and** showDue are on | One span from scheduled to due, replacing the separate events |
| `showRecurring` | toggle | `CS.defaultShowRecurring` (true) | always | Projected recurring instances (next-scheduled + pattern) |
| `showCompletedRecurringInstances` | toggle | true | only when showRecurring is on | Show / hide completed instances |
| `showSkippedRecurringInstances` | toggle | true | only when showRecurring is on | Show / hide skipped instances |
| `showTimeEntries` | toggle | `CS.defaultShowTimeEntries` (false) | always | Finished time entries |
| `showTimeblocks` | toggle | `CS.defaultShowTimeblocks` (true) | always | Timeblocks from daily-note frontmatter |
| `showPropertyBasedEvents` | toggle | true | always | Events from `startDateProperty` |

**Date navigation** (:229-271)

| key | type | default | notes |
|---|---|---|---|
| `initialDate` | text | `""` | Fixed date. Checked first. Normalised with `normalizeDateValueForCalendar`; if that fails, the raw string is passed |
| `initialDateProperty` | property (filter `note.*` / `file.*`) | null | Takes the date from entries |
| `initialDateStrategy` | dropdown `first` \| `earliest` \| `latest` | `first` | Only shown when `initialDateProperty` is set |
| `createDailyNotesFromDateLinks` | toggle | true | Clicking a date link creates the daily note if missing. When false, a "no daily note" notice is shown |

**View** (:273-324)

| key | type | default | allowed / notes |
|---|---|---|---|
| `calendarView` | dropdown | `CS.defaultView` (`dayGridMonth`) | `dayGridMonth` (Month), `timeGridWeek` (Week), `timeGridCustom` (Custom days), `timeGridDay` (Day), `listWeek` (List), `multiMonthYear` (Year) (:10-17) |
| `customDayCount` | slider 1–14, step 1 | `CS.customDayCount \|\| 3` | Only for `timeGridCustom` |
| `listDayCount` | slider 1–365 | 7 | Only for `listWeek` |
| `heightMode` | dropdown `fill` \| `auto` | `fill` | Normalised: anything other than `"auto"` becomes `fill` |

**Display** (:326-399)

| key | type | default | notes |
|---|---|---|---|
| `firstDay` | dropdown `"0"`–`"6"` (stored as a string) | `String(CS.firstDay)` (1) | Converted with `Number()` at runtime (:1039) |
| `timeFormat` | dropdown `"12"` \| `"24"` | `CS.timeFormat` (`"24"`) | |
| `weekNumbers` | toggle | `CS.weekNumbers` (false) | Hidden for listWeek |
| `showWeekends` | toggle | `CS.showWeekends` (true) | Maps to FullCalendar `weekends` |
| `showAllDaySlot` | toggle | true | Maps to `allDaySlot`. In list views, false also removes all-day events (:228-245) |
| `showTodayHighlight` | toggle | `CS.showTodayHighlight` (true) | False adds the CSS class `hide-today-highlight` to `#bases-calendar` |
| `todayColumnWidthMultiplier` | slider 1–5, step 0.5 | 1 | Only for timeGridWeek / timeGridCustom. Clamped and rounded to 0.5; out-of-range values become 1 |
| `enableSearch` | toggle | false | Search box from BasesViewBase. Filters tasks only |

**Time grid group** (:401-459; whole group shown only for timeGrid views)

| key | type | default | validation (`src/utils/calendarTime.ts`) |
|---|---|---|---|
| `slotMinTime` | text | `CS.slotMinTime` (`00:00:00`) | `HH:MM[:SS]`, hours ≤ 23 |
| `slotMaxTime` | text | `CS.slotMaxTime` (`24:00:00`) | hours ≤ 48; at 48 only `48:00` is allowed |
| `slotDuration` | text | `CS.slotDuration` (`00:30:00`) | ≤ 23h |
| `snapDuration` | text | `CS.slotDuration` | Falls back to the effective slotDuration |
| `scrollTime` | text | `CS.scrollTime` (`08:00:00`) | |
| `nowIndicator` | toggle | `CS.nowIndicator` (true) | |
| `showTimeGrid` | toggle | true | False hides the hour grid with CSS classes `advanced-calendar-view--hide-time-grid` / `__calendar--hide-time-grid`, leaving only the all-day row. In that case an "auto" `dayMaxEvents` becomes `false` (unlimited) (`CalendarView.ts:282`) |
| `selectMirror` | toggle | `CS.selectMirror` (true) | |

Invalid values log a warning and fall back to the previous value.

**Event layout group** (:461-533; shown for timeGrid views, month and year)

| key | type | default | runtime conversion (`CalendarView.ts:1090-1117`) |
|---|---|---|---|
| `slotEventOverlap` | toggle | `CS.slotEventOverlap` (true) | timeGrid only |
| `eventMinHeight` | slider 15–100, step 5 | `CS.eventMinHeight` (15) | timeGrid only |
| `eventMaxStack` | slider 0–10 | `CS.eventMaxStack ?? 0` | 0 → null → `undefined` passed to FullCalendar |
| `dayMaxEvents` | slider 0–20 | number in CS, else 0 | **0 → `true` (auto)**, n → n |
| `dayMaxEventRows` | slider 0–10 | number in CS, else 0 | **0 → `false` (unlimited)**, n → n |

**Property-based events group** (:535-567; hidden when `showPropertyBasedEvents` is false). All three are property pickers filtered by `isNoteFileOrFormulaProperty`:
- `startDateProperty`: required for property events to be built.
- `endDateProperty`
- `titleProperty`

**External calendar toggles** (dynamic, :84-133). Each is a toggle with default `true`:
- `showICS_<subscriptionId>`, one per ICS subscription
- `showGoogleCalendar_<calendarId>`
- `showMicrosoftCalendar_<calendarId>`

At runtime a Google calendar with `primary` is also registered under `PRIMARY_CALENDAR_ALIAS` (`calendarExternalEvents.ts:44`). The toggle id is the event's `subscriptionId` with the `google-` / `microsoft-` prefix removed (:26-37).

**Not configurable per view:** `locale` comes from `CS.locale`, then `settings.uiLanguage`, then `navigator.language`, then `"en"` (`CalendarView.ts:1337-1341`).

**Shipped templates** (`src/templates/defaultBasesFiles.ts:877-893, 913-928`):
- "Calendar": `calendarView: timeGridWeek`, all show* flags true, `customDayCount: 3`, `firstDay` from CS.
- "Agenda": `listWeek`, `showOverdueOnToday: true`, `showPropertyBasedEvents: false`, `startDateProperty: file.ctime`, `titleProperty: file.basename`, `listDayCount: 7`.

### 1.3 Config snapshot (keys that trigger a full recreate)
`calendarConfigSnapshot.ts:5-51` lists every key above (except `enableSearch`), plus the dynamic `showICS_*`, `showGoogleCalendar_*` and `showMicrosoftCalendar_*` keys. The snapshot is the JSON of their values. If it changes inside `onDataUpdated`, the calendar is destroyed and rebuilt (§4.3).

### 1.4 Global plugin settings that affect the calendar
`calendarViewSettings` type: `src/types/settings.ts:359-407`. Defaults: `src/settings/defaults.ts:128-171`. Loading merges saved values over defaults (`settingsPersistence.ts:226`).

| setting | default | UI | used for |
|---|---|---|---|
| `defaultView` | dayGridMonth (type allows month/week/day/year/custom; listWeek only via view config) | `appearanceTab.ts:~170-215` | default `calendarView` |
| `customDayCount` | 3 (settings UI 2–10) | `appearanceTab.ts:218-240` | default |
| `slotDuration` | `00:30:00` (dropdown 15/30/60 min) | `appearanceTab.ts:~495-520` | default slotDuration and snapDuration |
| `slotMinTime`, `slotMaxTime`, `scrollTime` | 00:00 / 24:00 / 08:00 | `appearanceTab.ts:533-640` | defaults |
| `firstDay` | 1 | `appearanceTab.ts:252` | default |
| `timeFormat` | `"24"` | `appearanceTab.ts:151` | default |
| `showWeekends`, `weekNumbers`, `showTodayHighlight`, `nowIndicator`, `selectMirror` | true, false, true, true, true | `appearanceTab.ts:267-323` | defaults |
| `locale` | `""` (auto; checked with `Intl.getCanonicalLocales`) | `appearanceTab.ts:330-367` | FullCalendar `locale` |
| `defaultShowScheduled`, `defaultShowDue`, `defaultShowTimeEntries`, `defaultShowRecurring` | true, true, false, true | `appearanceTab.ts:390-455` | defaults |
| `defaultShowScheduledToDueSpan` | false | n/a | default |
| `eventMinHeight` | 15 | `appearanceTab.ts:654` | default |
| `slotEventOverlap`, `eventMaxStack`, `dayMaxEvents`, `dayMaxEventRows` | true, null, true, false | no UI | defaults |
| `enableTimeblocking` | false | `featuresTab.ts:910` | shows "Create timeblock" in the select menu (`CalendarView.ts:2624`) |
| `defaultShowTimeblocks` | true | `featuresTab.ts:959` | default |
| `defaultTimeblockColor` | `#6366f1` | `featuresTab.ts:975` | timeblock colour fallback |
| `defaultShowDueWhenScheduled`, `defaultShowICSEvents` | n/a | settings UI | **not read by the Bases calendar** |

Other global settings that matter:
- `singleClickAction` / `doubleClickAction` (`edit` \| `openNote` \| `none`): task click handling (`src/utils/clickHandlers.ts:284`).
- `hideCompletedFromOverdue` (default true): the overdue-on-today logic.
- `uiLanguage`: locale fallback.
- Priority colours (`priorityManager`) and `statusManager.isCompletedStatus`.
- Field mapping (`fieldMapper`): frontmatter names for scheduled/due.
- `disableCalendarOnMobile`: on mobile, skips initialising ICS/Google/Microsoft services (`src/utils/calendarIntegration.ts`, `pluginBootstrap.ts:427`).
- ICS subscriptions: `name`, `color`, `enabled`. A disabled subscription produces no events (`calendar-core.ts:723`).
- The Daily Notes core plugin is required for timeblocks and date-link navigation.

---

## 2. Event kinds

All builders return FullCalendar `EventInput`. Assembly is in `CalendarView.ts:1855-1979` (`buildAllEvents`), in this order: task events (`generateCalendarEvents` with `showICSEvents:false`), then property events, then ICS, Google, Microsoft.

Shared colour rule ("priority colour" below):
- `borderColor = normalizeThemeColor(priorityColor, fallback)`.
- `textColor` = theme text (`#e8eaed` dark / `#202124` light) if the border is a CSS variable, otherwise the border colour.

Every event's `extendedProps.eventType` is one of `scheduled | due | scheduledToDueSpan | timeEntry | recurring | ics | timeblock | property-based` (`calendar-core.ts:69-113`).

| Kind | id | start / end / allDay | colours | extendedProps | builder |
|---|---|---|---|---|---|
| **Scheduled** | `scheduled-<path>` | start = `task.scheduled`. Timed with an estimate: end = start + estimate (`yyyy-MM-dd'T'HH:mm`). All-day: end = `calculateAllDayEndDate` (ceil(estimate/1440) days, exclusive), else none. allDay = no time part | bg `transparent`; priority colour (fallback `var(--color-accent)`) | `taskInfo`, `eventType:"scheduled"`, `isCompleted` (status) | `calendarTaskEvents.ts:55-97` |
| **Due** | `due-<path>` | start = `task.due`. Timed: end = min(start+30m, next midnight). All-day: no end | bg = border at α 0.15; priority colour (fallback `var(--color-orange)`) | `eventType:"due"`, taskInfo, isCompleted | :99-143 |
| **Span, all-day** (scheduled has no time) | `span-<path>` | `yyyy-MM-dd(scheduled)` → due+1 day (exclusive); allDay; only if due > scheduled | bg α 0.2, accent fallback | `eventType:"scheduledToDueSpan"` | :161-198 |
| **Span, timed** | `span-<path>-<yyyy-MM-dd>`, one per day from scheduled date to due date | each day at the scheduled time; end = +estimate if set; allDay false; filtered to the visible range | same | same | :200-267 |
| **Time entry** | `timeentry-<path>-<index>` | `entry.startTime` → `entry.endTime` (ISO); allDay false. Only finished entries that overlap the range (exclusive ends) | none set (FullCalendar default) | `eventType:"timeEntry"`, `timeEntryIndex`, taskInfo, isCompleted | :320-351 |
| **Recurring: next scheduled** | `next-scheduled-<path>-<instanceDate>` | `task.scheduled` (date plus time if present). End as for scheduled | bg transparent, completed `rgba(0,0,0,0.3)`, skipped `rgba(128,128,128,0.2)`; priority colour | `eventType:"scheduled"`, `isNextScheduledOccurrence:true`, `instanceDate`, `recurringTemplateTime`, `isCompleted`/`isSkipped` (from `complete_instances`/`skipped_instances`); editable true | `calendar-core.ts:951-1004` |
| **Recurring: pattern instance** | `recurring-<path>-<date>` | `<date>T<templateTime>` if scheduled had a time, else `<date>`. templateTime = DTSTART time in the RRULE, else scheduled time, else `09:00` (:828) | bg transparent / `rgba(0,0,0,0.2)` / `rgba(128,128,128,0.15)`; border = priority colour at α 0.5; text likewise unless a CSS var | `eventType:"recurring"`, `isPatternInstance:true`, instanceDate, recurringTemplateTime; editable true | :1009-1064 |
| **Recurring: recorded instance** (a date in complete/skipped_instances with no projected instance) | `recurring-recorded-<path>-<date>` | as pattern | as next-scheduled | `eventType:"recurring"`, `isRecurringInstance:true`; editable **false** (but see the override below) | :1070-1121 |
| **Recurring span** (span toggle on with a recurring task) | `span-<next-scheduled\|pattern\|recorded>-<path>-<instanceDate>-<eventDate>` | span built from instance date to instance date + (due−scheduled) days | span colours | span props plus the recurring flags; `taskInfo` = the template task; editable false | :897-946 |
| **Overdue on today** | `<originalId>-overdue-today` | original start moved to today keeping its time; end moved by the same amount | inherited | `isOverdueOnToday:true` | :1583-1611 |
| **Timeblock** | `timeblock-<tb.id>` | `<date>T<startTime>:00` → `<date>T<endTime>:00`; allDay false | bg = border = `tb.color \|\| CS.defaultTimeblockColor` (fallback `#6366f1`); text `var(--text-on-accent)` | `eventType:"timeblock"`, `timeblock`, `originalDate`; editable true | :1395-1422 |
| **ICS subscription** | `icsEvent.id` | from the ICS event. A timed event with end == start gets end + 1 ms (:778) | border = subscription colour (fallback `#3788d8`); bg α 0.2 | `icsEvent`, `eventType:"ics"`, `subscriptionName`, `isGoogleCalendar:false`, `isMicrosoftCalendar:false`, `relatedNoteCount?`; editable **false** | :690-769 |
| **Google** (`subscriptionId` starts with `google-`) | same | same | border `icsEvent.color \|\| #4285F4`; bg α 0.2; theme text | `subscriptionName:"Google Calendar"`, `isGoogleCalendar:true`; editable **true** | same |
| **Microsoft** (`microsoft-`) | same | same | `#0078D4` fallback | `isMicrosoftCalendar:true`; editable true | same |
| **Property-based** | `property-<file.path>` | start / end from `normalizeDateValueForCalendar`; title from the title property or basename / name / path; allDay = start is all-day and (end is all-day or there is no end) | `var(--color-accent)` bg/border, `var(--text-on-accent)` text | `eventType:"property-based"`, `filePath`, `file`, `basesEntry`; editable true | `calendarPropertyEvents.ts:117-167` |

`relatedNoteCount` comes from `plugin.icsNoteService.getRelatedNoteCountsByEventId()`. It is only fetched if any provider has events (`CalendarView.ts:1893-1900`).

### 2.1 Task event generation rules (`calendar-core.ts:1616-1839`)

**Date normalisation**
- `normalizeDateValueForCalendar` (`calendarPropertyEvents.ts:51`) accepts:
  - strings: time-aware → local `yyyy-MM-dd'T'HH:mm`; date-only → UTC-anchored `yyyy-MM-dd`; `"null"` / `"undefined"` are rejected
  - numbers → all-day date
  - Date objects → all-day if exactly midnight, otherwise timed

**Non-recurring tasks** (`addStandaloneDateEvents`)
1. If span is on and the task has scheduled and due, emit spans and **stop**.
2. Otherwise emit scheduled if it is in range. If it is not in range and overdue-on-today is on, emit the overdue copy (`isOverdueTimeAware`, honouring `hideCompletedFromOverdue`).
3. Due: suppressed when due is **date-only on the same day as scheduled** and scheduled is shown or generated (:888, :1695). Otherwise emit due, with the same overdue fallback. If scheduled already produced an overdue copy on today, a date-only due does not get one.
4. "In range" means start < visibleEnd and (start + estimate) ≥ visibleStart.

**Recurring tasks** (`task.recurrence` set; need `scheduled` plus a visible range)
- Instances are generated if showRecurring **or** showCompleted **or** showSkipped is on. Projected instances (next-scheduled + pattern) only when showRecurring is on. Recorded completed/skipped dates are always considered, gated by their own toggles.
- If showRecurring is on, the standalone scheduled event and standalone span are dropped. Standalone due is also dropped if recurring spans were emitted.
- Instance dates are skipped when they:
  - fall outside `[visibleStartDate, visibleEndDate)` (string comparison of FullCalendar `startStr` / `endStr`)
  - equal the next-scheduled date
  - are in `googleCalendarMovedOriginalDates` / `googleCalendarExceptionOriginalScheduled`
  - are **materialised occurrence** dates (child tasks with `recurrence_parent` + `occurrence_date` in the same result set, keyed by the resolved parent path)
  - are hidden by the completed/skipped toggles
- `FREQ=YEARLY` looks ahead 800 days. With spans on, the search start moves back by the span length.

**Materialised occurrence tasks** (children) are normal tasks. Their events get `isMaterializedOccurrence:true`, `instanceDate` / `occurrenceDate` = `occurrence_date`, and `occurrenceParent`.

**Time entries** are emitted if `showTimeEntries` is on.

**Timeblocks** are emitted if `showTimeblocks` is on:
- The code loops over each UTC day from visibleStart to visibleEnd **inclusive**.
- For each day it calls `getDailyNote(moment)`, using the `getAllDailyNotes()` result cached for 5 s.
- It reads `metadataCache` frontmatter `timeblocks[]`; each item needs string `id`, `startTime` and `endTime` (:1427-1514).

### 2.2 Post-processing in `buildAllEvents`

**Bases sort index**
- If Bases has a sort config, `extendedProps.tasknotesSortIndex` = the task's index in the filtered task list, otherwise the entry's index in `data.data` (`CalendarView.ts:1448-1464`, 202-226).
- Default `eventOrder` is `"start,-duration,allDay,title"`. With a Bases sort it is `"start,allDay,tasknotesSortIndex,-duration,title"` (:179-186).

**Editability override** (skipped when the current view is `listWeek`; :1944-1972)
- Timeblocks: editable true.
- Task events of type scheduled / recurring / timeEntry / due / scheduledToDueSpan: editable true, **except** span events that carry any recurring flag (false).
- `editable`, `startEditable` and `durationEditable` are all set.
- Property and provider events keep their own value.
- Side effect: recorded recurring instances (`editable:false` from the builder) become editable in non-list views.

**All-day filter**: in `list*` views with `showAllDaySlot:false`, events with `allDay === true` are dropped.

---

## 3. Interactions

### 3.1 FullCalendar options (`CalendarView.ts:1262-1432`)
- **Plugins:** dayGrid, timeGrid, list, interaction, multiMonth.
- **Header:** `headerToolbar = { left: "prev,next today refreshCalendars", center: "title", right: "multiMonthYear,dayGridMonth,timeGridWeek,timeGridCustom,timeGridDay,listWeek" }`.
- **Button text and hints:** translated `buttonText` and `buttonHints` (keys `views.basesCalendar.*`).
- **Custom views:**
  - `views.timeGrid.dayMaxEvents` = `getTimeGridDayMaxEvents(...)`
  - `timeGridCustom` = `{type:"timeGrid", duration:{days:customDayCount}, buttonText: i18n("…customDays",{count}), titleFormat:{year:"numeric",month:"short",day:"numeric"}}`
  - `listWeek` = `{type:"list", duration:{days:listDayCount}}`. "listWeek" is really an N-day list.
- **Sizing:**
  - `fill`: `{height:"100%", expandRows:true}`.
  - `auto`: `{height:"auto", contentHeight:"auto", expandRows:false}`.
  - Inside `.internal-embed, .markdown-embed`, `auto` is always used (:316-327).
  - Also `handleWindowResize:false`, `stickyHeaderDates:false`.
- **Time formats:**
  - `eventTimeFormat` for 12h: `{hour:"numeric",minute:"2-digit",omitZeroMinute:true,meridiem:"short",hour12:true}`. For 24h: `{hour:"2-digit",minute:"2-digit",hour12:false}`.
  - `slotLabelFormat {hour:"2-digit",minute:"2-digit",hour12: timeFormat==="12"}`.
- **Flags:** `navLinks:true`, `editable:true`, `selectable:true`, `eventAllow:()=>true`.
- **Mobile:** `longPressDelay` / `eventLongPressDelay` / `selectLongPressDelay` = 350.
- **Callbacks wired:** `events` (function source), `eventDidMount`, `eventClick`, `eventDrop`, `eventResize`, `select`, `viewDidMount`, `datesSet`, `navLinkDayClick`, `dayHeaderDidMount`.

### 3.2 Drag/drop (`handleEventDrop`, `CalendarView.ts:2210-2432`)

**Timeblock**
- `originalDate` = old start as `yyyy-MM-dd`.
- Calls `handleTimeblockDrop` (`calendar-core.ts:1964`), which reads the new date, start (`HH:mm`) and end (`HH:mm`).
- With **Ctrl, Cmd or Alt** held: `copyTimeblockToDailyNote` (new id), then revert the visual change, fire `EVENT_DATA_CHANGED`, and show "Timeblock duplicated".
- Otherwise: `updateTimeblockInDailyNote(app, id, originalDate, newDate, start, end)`. This moves the entry between daily notes' frontmatter `timeblocks`.
- Revert if there is no end.

**Property-based**
- Front-matter names: `getCalendarFrontmatterPropertyName` takes the text after the last `.` (`note.start` → `start`).
- `processVaultFrontMatter`:
  - start property = old value + (newStart − oldStart)
  - end property shifted the same way if present
  - format `yyyy-MM-dd` if the event is all-day after the drop, else `yyyy-MM-dd'T'HH:mm`
- Revert if there is no start property or no file (`calendarMutationPlanning.ts:223-273`).

**ICS / provider events**
- `calendarProviderRegistry.findProviderForEvent(icsEvent)`, then `provider.extractEventIds` and `provider.updateEvent(calendarId, eventId, updates)`.
- Updates: all-day → `{start:{date}, end:{date}}`. Timed → `{start:{dateTime:"yyyy-MM-dd'T'HH:mm:ss", timeZone}, end:{…}}`, using the local Intl time zone.
- A missing end defaults to +1 day (all-day) or +1 h (timed) (`calendarMutationPlanning.ts:371-420`).
- No provider (plain ICS): revert.

**Time entry**
- Shift the entry at `timeEntryIndex` by (newStart − oldStart). Both times are written as ISO strings; the legacy `duration` field is removed from all entries.
- `taskService.updateTask(task, {timeEntries})`, then refresh.

**Recurring** (any of `isRecurringInstance` / `isNextScheduledOccurrence` / `isPatternInstance`, and *not* a materialised occurrence child) → `handleRecurringTaskDrop` (`calendar-core.ts:419-467`):
- **Next scheduled:** `scheduled` = new start (`yyyy-MM-dd` or `yyyy-MM-dd'T'HH:mm`). Notice: "Rescheduled next occurrence…".
- **Pattern instance:** changes `recurrence`.
  - No DTSTART yet: `addDTSTARTToRecurrenceRuleWithDraggedTime`.
  - DTSTART present: keep its date and replace the time with `THHmm00Z` using the dragged **local** hours (it is written with a `Z` suffix). All-day keeps the date only.
  - `scheduled` is left unchanged.
- **Recorded / legacy:** `scheduled` = original date + new time (or the date only if all-day).

**Scheduled / due** (including materialised children)
- `taskService.updateProperty(task, "scheduled"|"due", formatted new start)`; all-day → `yyyy-MM-dd`.

**Span**
- Shift both scheduled and due by the time difference, keeping each value's own date-only/timed form.
- Written directly via `processVaultFrontMatter` using the mapped field names.

**After task writes**: `refreshAfterDirectCalendarTaskWrite` clears debounce timers, rebuilds `currentTasks` from `cacheManager.getCachedTaskInfoSync` (skipping archived, merging the updated task), then `calendar.refetchEvents()`. Errors trigger `info.revert()`.

### 3.3 Resize (`CalendarView.ts:2434-2591`)
| Event kind | Behaviour |
|---|---|
| Time entry | Set the entry's start and end to the new range (ISO) |
| Timeblock | `handleTimeblockResize`: same date, new `HH:mm` start and end |
| Property-based | Set the end property to the new end. Revert if no end property is configured |
| Provider | `updateEvent` with `requireEnd:true` |
| Scheduled or recurring (`eventType`) | `timeEstimate` = the new duration in minutes. All-day: whole days × 1440. Writes to the template task for recurring events |
| Anything else (due, span, plain ICS) | Revert |

### 3.4 Select to create (`handleDateSelect`, :2593-2702)
An Obsidian `Menu` with these items:
1. **"Create task"** (icon `check-square`): `TaskCreationModal` prefilled by `calculateTaskCreationValues`:
   - `scheduled` = start (date for all-day, else `yyyy-MM-dd'T'HH:mm`)
   - `timeEstimate`: days × 1440 if the all-day selection is more than 1 day; the selection length in minutes if a timed selection is longer than slotDuration; otherwise unset
   - On create: direct refresh.
2. **"Create timeblock"** (`clock`), only if `enableTimeblocking`. All-day selections are rejected with a notice. Otherwise opens `TimeblockCreationModal {date, startTime, endTime}`. On create, refetch once the daily note's metadata contains the new id (watches `metadataCache` "changed"; 2 s fallback; :2154-2208).
3. **"Create time entry"** (`play`): all-day selections are rejected. Opens a task selector over all unarchived tasks and appends `{startTime: ISO, endTime: ISO, description:""}`. Then `EVENT_DATA_CHANGED` and a notice.
4. Separator, then **"Create external calendar event"** (`calendar-plus`), only if some provider has calendars. Opens `CalendarEventCreationModal {start,end,allDay}`; on create calls `registry.refreshAll()`.

Closing the menu calls `calendar.unselect()`. Menu position: on touch, from `changedTouches[0]`; otherwise `showAtMouseEvent`.

### 3.5 Click (`handleEventClick`, :2101-2152)
- **Timeblock:** `TimeblockInfoModal(timeblock, eventStart, originalDate)`.
- **Time entry, left button:** `plugin.openTimeEntryEditor(task)`.
- **ICS / provider:** `ICSEventInfoModal(icsEvent, subscriptionName)`.
- **Property-based:** opens the file. Ctrl/Cmd or middle click opens a new leaf.
- **Task, left button:** `handleCalendarTaskClick`:
  - Ctrl/Cmd: open the note in a new tab.
  - Otherwise follows `singleClickAction` / `doubleClickAction`. A double-click is detected per event id within 250 ms; when `doubleClickAction === "none"` the click is handled immediately.

### 3.6 `eventDidMount` (:2704-2907)
Order of operations:
1. On mobile: add class `tn-calendar-event-touch-target` and block `contextmenu` in the capture phase (:117-129).
2. ICS decoration (`calendarEventMount.ts:86`):
   - `data-ics-event="true"`, class `fc-ics-event`
   - with related notes: classes `has-related-note fc-event--has-related-note` and `data-related-note-count`
   - not in listWeek: a `.fc-event-provider-icon` (`calendar` icon) if a provider owns the event, plus a `file-text` indicator in `.fc-event-title`
3. **listWeek:** the row is replaced with a card in `<td class="fc-list-event-title fc-list-card-content" colspan=3>`:
   - tasks: `createTaskCard` (task enriched with the Bases entry, formulas, ctime/mtime; `targetDate`; `promoteOccurrenceControlsInContextMenu`)
   - ICS: `createICSEventCard`
   - property events: `createPropertyEventCard(basesEntry, plugin, config)`
   - timeblocks: `createTimeBlockCard`
   - row classes: `fc-list-task-card`, `fc-task-event` + `data-task-path`; removes `fc-event fc-event-start fc-event-end`
   - stops here
   - fallback when there is no card: class `fc-event-default-list` and processing continues
4. `data-event-type` attribute.
5. **Timeblock:** `data-timeblock-id`, classes `fc-timeblock-event` and solid 2px border, tooltip `title - description (n attachments)`. Stops here.
6. **Task:**
   - `data-task-path`, `fc-task-event`
   - `fc-tag-<sanitised>`, `fc-project-<sanitised>`
   - hovering one event highlights all events of the same task: `fc-task-event--hover-source` / `--related-hover`
   - recurring styling (`calendar-core.ts:259`):
     - next-scheduled: `fc-next-scheduled-event`, `data-next-scheduled`, solid 2px; completed → opacity 0.6
     - pattern: `fc-pattern-instance-event`, `data-pattern-instance`, dashed 2px, opacity 0.7 (0.4 if completed)
     - recorded: `fc-recurring-event`, `data-recurring`, dashed
     - materialised: `fc-materialized-occurrence-event`, `data-materialized-occurrence`
     - completed: strikethrough on `.fc-event-title` plus `fc-completed-event`
7. **Tooltips:** tasks show title / Project / Priority / Status / Estimate (`calendar-core.ts:230`). ICS shows title, description and related-note count.
8. **Hover preview:** `workspace.trigger("hover-link", {source:"tasknotes-bases-calendar", linktext: path})` on `mouseover`, for tasks and property events.
9. **Context menus:**
   - Tasks (including time entries): `TaskContextMenu` with `targetDate = getTargetDateForEvent` (instanceDate as a UTC anchor for recurring events, else the event's start date), `occurrenceDate` (only `instanceDate` of recurring tasks), `promoteOccurrenceControls`. `onUpdate` → `refreshCalendarWithFreshData`.
   - ICS / provider: `ICSEventContextMenu`.
   - Property events: a `Menu` filled by `workspace.trigger("file-menu", menu, file, "tasknotes-bases-calendar")`.

### 3.7 Date links, toolbar, keyboard, view persistence
**Date links**
- `navLinkDayClick` and the `timeGridDay` header (`attachDailyNoteHeaderLink`, `calendar-core.ts:2205`) call `handleDateTitleClick(date, {createIfMissing: createDailyNotesFromDateLinks})`, which opens or creates the daily note.
- The day header is re-attached 0 and 50 ms after `viewDidMount`, `datesSet` and resize.

**Refresh button** (`refreshCalendars`)
- Runs `icsSubscriptionService.refreshAllSubscriptions()`, `googleCalendarService.refreshAllCalendars()` and `microsoftCalendarService.refreshAllCalendars()`, then `refetchEvents()` (:1520-1542).
- Its content is replaced by the `refresh-cw` icon, with class `tasknotes-calendar-refresh-button--icon` and aria-label / title (:131-141).

**Keyboard**
- The calendar itself has no key handlers.
- From `BasesViewBase.setupSelectionHandling` (`BasesViewBase.ts:798`, `basesSelectionUi.ts:187`), only while selection mode is active: Esc exits, Ctrl/Cmd+A selects all, arrows extend the selection. These act on `.task-card[data-task-path]`, which only exist in list mode.

**View type persistence**
- `viewDidMount`: if the view type differs from the current option, it is saved after 1000 ms with `config.set("calendarView", type)` (`debouncedSaveViewType`, :1745-1771).
- It is never saved on unload (issue #1397).

**Date and scroll persistence (not written to config)**
- `getEphemeralState` returns `{scrollTop, containerScrollTop, calendarDate: ISO, calendarScroll: [{scrollTop, scrollLeft}…]}`. `calendarScroll` covers `#bases-calendar` and each `.fc-scroller`.
- `setEphemeralState` calls `gotoDate(calendarDate)` and restores scroll over two animation frames. It ignores legacy `calendarView` state (:3091-3146).
- Every non-initial render goes through `renderPreservingEphemeralState`.

**Other DOM work**
- Today column width: for timeGridWeek / timeGridCustom with multiplier > 1, sets the width of header, timegrid and daygrid cells and their `<col>` to percentages (:429-448, 1618-1673).
- Layout classes:
  - root: `advanced-calendar-view--auto-height`, `--hide-time-grid`, `--list`
  - calendar element: `advanced-calendar-view__calendar--…`
  - root className is `tn-bases-integration tasknotes-plugin advanced-calendar-view`
  - calendar element id: `bases-calendar`
- The Bases toolbar gets a custom "New" button → `createFileForView` → `TaskCreationModal` with defaults from the view's filters (`BasesViewBase.ts:353-528`).

---

## 4. Data flow

### 4.1 Lifecycle
- **Constructor:** sets defaults from CS and links `dataAdapter.basesView = this`.
- **`onload`** (:615):
  1. `readViewOptions()`
  2. stores the config snapshot, data signature and controller `viewName`
  3. `installCanvasTimeGridScaleCorrection()`: patches `TimeColsSlatsCoords.prototype.computeTimeTop` to divide by the Canvas zoom scale (`calendarCanvasScale.ts`)
  4. `super.onload()`: setupContainer, task update listeners, selection handling, `render()`
- **`render()`** (:1155-1253):
  - Guarded by a lock with a pending-render flag.
  - In a popout window: shows the "unsupported" notice.
  - Needs `this.data?.data`.
  - Re-reads event toggles each render. Re-reads everything and recreates the calendar when `_configChangedNeedsRecreate` is set. On recreate it keeps the visible date unless `initialDate`, `initialDateProperty` or `initialDateStrategy` changed (`calendarRecreateUtils.ts`).
  - `dataAdapter.extractDataItems()` → `identifyTaskNotesFromBasesData` → `applySearchFilter` → `currentTasks`.
  - Builds `basesEntryByPath` from `this.data.data`.
  - First time: `initializeCalendar` (`new Calendar(el, opts).render()`). Afterwards: `setOption("eventOrder", …)` + `refetchEvents()`.
- **Initial date** (`calendarInitialDate.ts`):
  - `initialDate` wins.
  - Otherwise collect `dataAdapter.getPropertyValue(entry, initialDateProperty)` over entries. If there are none, fall back to task fields via `propertyMapper.basesToTaskCardProperty` and customProperties.
  - If still nothing and the view is embedded in a markdown note, use the host note's frontmatter (tries `prop`, the mapped name, and the name without `note.` / `task.`) (`CalendarView.ts:1787-1831`).
  - Then apply first / earliest / latest.
- **Events:** one function event source. FullCalendar calls `fetchEvents(fetchInfo)` on every range change or `refetchEvents()`. That calls `buildAllEvents` with `start`, `end`, `startStr` and `endStr`.
- **Property values:** `entry.getValue(propertyId)` through `convertBasesValueToNative`. Sorting: `config.getSort()`. Visible properties: `config.getOrder()`.

### 4.2 Update triggers
**`onDataUpdated`** (Bases, :650-693):
1. If not connected: ignore.
2. First call after load: render immediately.
3. If `_expectingImmediateUpdate` (set by `expectImmediateUpdate()`, auto-cleared after 2 s; used by modals, time entry creation and similar): render now, keeping ephemeral state.
4. If the config snapshot changed: recreate and render now.
5. If the **data signature** changed: render now. The signature is JSON of the paths plus these property values (`calendarDataSignature.ts`):
   - mapped fields title, status, priority, due, scheduled, contexts, projects, timeEstimate, completedDate, recurrence, recurrenceAnchor, timeEntries, completeInstances, skippedInstances, blockedBy, icsEventId, googleCalendarEventId, googleCalendarExceptionOriginalScheduled, googleCalendarMovedOriginalDates, reminders, sortOrder
   - `tags`, `archived`
   - the visible properties
   - the start / end / title properties when property events are on
6. Otherwise poll the signature every 250 ms for up to 2 s.
   - If the Bases `viewName` changed: render at 2 s.
   - Otherwise keep checking until 5 s, with **no forced render**.

**Plugin emitter** (`basesTaskUpdateListeners.ts`): `EVENT_TASK_UPDATED`, `EVENT_TASK_DELETED`, `file-deleted`.
- `handleTaskUpdate` (:2973):
  - Expected write: refresh from the cache.
  - `source === "tasknotes-service"`: `refreshCalendarWithFreshData(task)` (cache-based, then `refetchEvents`).
  - Otherwise `debouncedRefresh` (300 ms → render).

**Bases controller `onConfigChanged`** is wrapped and calls `debouncedRefresh` (`basesRefreshLifecycle.ts:56`). This path only re-reads event toggles. Layout recreation depends on the `onDataUpdated` snapshot check.

**`onResize`**: `calendar.updateSize()` if the element is connected, in the same document and has a non-zero size. Also reapplies today width and header links.
- A `MutationObserver` on a parent `.canvas` element's `style` calls `onResize` when the zoom scale changes (:1675-1696).

### 4.3 FullCalendar API used
- Construction: `new Calendar(el, options)`, `.render()`, `.destroy()`.
- Updates: `.refetchEvents()`, `.setOption("eventOrder", v)`, `.updateSize()`, `.unselect()`, `.getDate()`, `.gotoDate(d)`, `.view.type`.
- `changeView` is typed but not used.
- Callback args used:
  - `EventSourceFuncArg` (start, end, startStr, endStr)
  - `EventDropArg` (event, oldEvent, revert, jsEvent)
  - `EventResizeDoneArg`
  - `DateSelectArg` (start, end, allDay, jsEvent)
  - `EventClickArg` (event, jsEvent)
  - `EventMountArg` (el, event, view.type)
- Event fields used: `start`, `end`, `allDay`, `id`, `extendedProps`.
- Internal: `TimeColsSlatsCoords` from `@fullcalendar/timegrid/internal` (Canvas patch).
- Fixed timing in the view: 1000 ms view-type save, 300 ms debounced refresh, 250 ms / 2 s / 5 s signature polling, 2 s timeblock refetch fallback, 250 ms double-click window.

---

## 5. Mobile and popout
**Mobile** (`Platform.isMobile`)
- Long-press delays of 350 ms for events and selection (:1365-1371).
- The native context menu is blocked on event elements (capture phase), and they get class `tn-calendar-event-touch-target` (:117).
- The task context menu still attaches. On touch devices, long press is used for drag and select.
- The select menu is positioned from `TouchEvent.changedTouches` / `touches`, with the calendar's top-left as fallback (:2685-2701).
- `disableCalendarOnMobile` skips starting the ICS/Google/Microsoft services, so those events are absent.

**Popout windows**
- Detection: `containerEl.ownerDocument.defaultView !== window` (`isCalendarInPopoutWindow`, :388).
- In a popout, `render()` and `onResize()` destroy any calendar and show "Calendar view is unavailable in a separate window" (class `advanced-calendar-view__popout-blocked`; :1706-1731), because it can freeze Obsidian.
- DOM elements are created with `createElementInDocument(ownerDocument)`. Timers use `ownerDocument.defaultView`.

**Embeds and Canvas**
- Inside `.internal-embed, .markdown-embed`: height mode is forced to `auto`, and the initial date can come from the host note's frontmatter.
- Inside a Canvas: the `computeTimeTop` correction and the zoom `MutationObserver` described above.