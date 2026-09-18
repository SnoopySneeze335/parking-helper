# AGENTS.md

Last updated: 2026-09-18

## Scope

These instructions apply to the entire Parking Helper repository. Keep this file current after meaningful implementation, deployment, or product-planning changes.

## Project mission

Parking Helper is a mobile-first web app for remembering a parked vehicle inside Cal Poly's R4 parking garage. A user selects a floor, a landmark-based zone, and optionally an individual stall; the app later reconstructs that location visually.

The current repository is a browser-based navigation prototype. It deliberately uses simple CSS garage, vehicle, and 3D placeholders while the final floor plans and Three.js assets are still being developed.

## Sources of truth

Use these in priority order:

1. The user's current request.
2. **Plan.md**, when present, for product intent and the full navigation tree.
3. **STORAGE_DESIGN.md**, when present, for the approved local-persistence architecture.
4. The current working application and tests.
5. This file for repository workflow, status, and handoff notes.

Plan.md, prompt.txt, and STORAGE_DESIGN.md are currently local-only and ignored by Git. AGENTS.md must therefore remain useful even when those files are unavailable in a remote checkout.

## Product constraints

- Keep the UI mobile-first and touch-friendly; verify at approximately 390 x 844 CSS pixels.
- Current production code is plain HTML, CSS, and JavaScript with no build tool or framework.
- The current prototype must not make network requests or depend on external libraries/CDNs.
- User data must remain on the device. No accounts, server storage, cookies, or remote telemetry.
- When persistence is implemented, all localStorage access must live in one dedicated module. UI code must never access localStorage directly.
- Preserve usable fallback screens when no parking location or history exists.
- Preserve reduced-motion support and keyboard/focus behavior.
- Treat the real garage geometry, floor layouts, zone definitions, stalls, vehicle models, and About copy as pending assets/content unless a task supplies them.

## Repository map

| File | Purpose |
| --- | --- |
| index.html | Static app shell, header, settings sheet, toast container, and app script entry point. |
| app.js | Current single-page navigation, in-memory state, render functions, and event handling. |
| styles.css | Responsive mobile UI, garage/vehicle placeholders, animations, and interaction states. |
| README.md | Short public repository introduction. |
| README-old.md | Detailed prototype usage notes and preview-query documentation. |
| Plan.md | Local-only product plan and navigation tree. |
| STORAGE_DESIGN.md | Local-only design for versioned localStorage persistence. |
| prompt.txt | Local-only task prompt; do not commit. |
| .gitignore | Keeps local planning/prompt documents out of Git. |

## Current frontend behavior

- The app is an IIFE-based single-page interface; screens are rendered into the #screen element.
- First-time and returning-user branches are currently simulated with query parameters.
- Parking data and vehicle selection currently live only in memory and reset on refresh.
- Returning-user demo mode contains sample parking history unless the empty-history flag is used.
- Vehicle choices are sedan, SUV, truck, and motorcycle.
- Vehicle colors are black, silver, grey, white, blue, red, and pink.
- Garage levels are 1-6. The placeholder floor has zones A-D and six placeholder stalls per zone.
- The save flow supports floor, zone, and optional stall selection.
- Retrieval shows a vehicle for a stall-specific save and a zone focus without a vehicle for a zone-only save.
- Parking history previews a selected record and can hand that record to the retrieval screen.
- Settings routes to vehicle selection or an About placeholder.

### Prototype query modes

- **index.html** or **?firstTime=1**: first-time warning and onboarding.
- **?firstTime=0**: returning user with demo history.
- **?firstTime=0&history=empty**: returning user with empty-state fallbacks.

These flags are prototype controls, not the final source of onboarding or history state.

## UX invariants and regressions to protect

- A first tap anywhere inside an unselected zone, including directly over a stall rectangle, selects the zone.
- Once a zone is selected, a tap on one of its stalls selects or changes the stall without zooming.
- The Save Zone/Save Spot button remains fixed, horizontally centered, and fully onscreen during hover and focus animations.
- Selecting a different zone clears the previously selected stall.
- Zone-only retrieval must not render a car in an arbitrary stall.
- The latest parking record is the default retrieval target; a selected history record overrides it for that retrieval.
- Back navigation must follow the in-app screen stack and return to the welcome screen cleanly.
- The settings and header controls must remain reachable on phone-sized screens.

## Local persistence plan

Persistence is designed but not implemented.

The next implementation should follow these rules:

- Add one dedicated **storage.js** module.
- Use a single versioned JSON document under a stable localStorage key.
- Persist current location, at most 100 newest-first history entries, vehicle selection, onboarding completion, and the one-time home-screen nudge flag.
- Canonical IDs are **F1-Z01** for zone-only and **F1-Z01-S001** for stall-specific saves.
- Store zone-only saves with stall set to null.
- Validate all inputs before writes.
- Migrate older schema versions sequentially.
- Handle unavailable storage, quota exhaustion, invalid input, and corrupt data without crashing or claiming that a session-only save is durable.
- Keep the default vehicle as a red sedan.
- Consult STORAGE_DESIGN.md for the proposed API, data schema, migration lifecycle, failure messages, and unresolved decisions.

## Run and verify

There is no package installation or build step.

### Run locally

Open index.html directly in a modern browser. A simple local static server is also acceptable when a browser feature requires an HTTP origin, but do not introduce a runtime dependency solely for the prototype.

### Minimum checks after JavaScript changes

~~~powershell
node --check app.js
~~~

Then manually exercise:

1. First-time warning, vehicle type, color, completion, and return to menu.
2. Save a zone-only location.
3. Save a stall-specific location and change the stall before saving.
4. Retrieve the latest location.
5. Select an older history entry and retrieve it.
6. Both no-location and no-history fallbacks.
7. Settings vehicle flow and About screen.
8. Back navigation at every step.
9. Zone hitboxes by tapping directly on stall areas before a zone is selected.
10. Save Spot hover/focus positioning at phone and desktop widths.

After persistence is implemented, also test refresh/reload, 101 saves and pruning, invalid IDs, corrupted JSON, unavailable localStorage, quota errors, schema migration, and repeat visits to the same location.

## Cloudflare Pages

The repository itself is the deployable output; index.html is at the root.

- Framework preset: None
- Production branch: main
- Root directory: leave blank
- Build command: exit 0
- Build output directory: .

A Pages deployment tests static hosting and real-device access only. Until local persistence and offline asset caching are implemented, it does not provide durable cross-refresh parking data or guaranteed garage access without connectivity.

localStorage is origin-scoped. Data saved on a pages.dev preview address will not transfer automatically to a later custom domain, so choose the permanent production origin before real user testing.

## Git workflow

- Repository: https://github.com/SnoopySneeze335/parking-helper
- Primary branch: main
- Inspect git status before editing and preserve unrelated user changes.
- Do not commit prompt.txt, Plan.md, or STORAGE_DESIGN.md while they remain intentionally ignored.
- Do not amend, force-push, reset, or discard user work unless explicitly requested.
- Do not push unless the user explicitly asks for a push.
- Use focused commit messages that describe the product change.
- Keep app behavior and documentation in sync.

## Prioritized to-do list

### P0 — Persistence and real-world test readiness

- [ ] Resolve the open storage-model questions below.
- [ ] Implement storage.js from STORAGE_DESIGN.md.
- [ ] Replace demo/query-based production state with initialized stored state while retaining an intentional developer preview mode if useful.
- [ ] Add visible durable/session-only/error messaging.
- [ ] Add storage validation and migration tests.
- [ ] Deploy main to Cloudflare Pages and verify the pages.dev site on iPhone and Android-sized screens.
- [ ] Select the permanent domain before collecting meaningful localStorage data.

### P1 — Offline and product completion

- [ ] Add an installable web-app manifest and final home-screen instructions.
- [ ] Decide whether to add a service worker for offline shell/assets.
- [ ] Replace placeholder garage geometry with accurate floor-specific maps, zone IDs, landmarks, ramps, supports, and stalls.
- [ ] Replace CSS vehicle placeholders with approved image/3D assets.
- [ ] Add final About Parking Helper content.
- [ ] Review accessibility with keyboard, screen reader, reduced motion, and touch targets.

### P2 — Later capabilities

- [ ] Evaluate Three.js integration and compressed garage/vehicle assets.
- [ ] Define delete-current, delete-history-entry, reset-all, and optional export/import controls.
- [ ] Investigate RFID/deep-link entry points.
- [ ] Investigate arrival reminders without adding accounts or remote tracking.
- [ ] Add adaptive landmark language for saved zones.

## Open product and architecture questions

- Should a legacy zone-only ID ending in S000 be accepted and migrated, or rejected entirely in favor of F1-Z01?
- What numeric IDs replace the prototype's A-D zones, and are zones/stall ranges different on each floor?
- Should a history record be identified by location ID plus timestamp, or receive a separate opaque record ID?
- Should historical locations render the user's current vehicle or retain a vehicle snapshot from the original save?
- If first-time vehicle setup is abandoned, should the app persist the default red sedan and mark onboarding complete, or show setup again?
- Is the home-screen warning permanently one-time, or should it reappear whenever the app detects non-standalone use?
- Should quota errors allow a clearly labeled session-only save or block saving entirely?
- Which custom domain will be the permanent localStorage origin?

## Completed work log

- **2026-09-02:** Built the initial offline navigation prototype with onboarding, vehicle selection, welcome actions, level/zone/stall saving, retrieval, history, settings, About placeholder, and empty states.
- **2026-09-02:** Added exact-phone-width browser smoke coverage for onboarding, save, retrieve, history, and empty-state flows.
- **2026-09-16:** Expanded zone selection so tapping anywhere inside a zone selects it before individual stall selection.
- **2026-09-16:** Fixed the floating Save Spot hover transform so the button remains centered and onscreen.
- **2026-09-16:** Moved project files into the local parking-helper Git repository and synchronized main with GitHub.
- **2026-09-16:** Documented the versioned, failure-tolerant localStorage architecture in STORAGE_DESIGN.md without changing app code.
- **2026-09-18:** Repository was clean and synchronized at commit d0ef3e8 before AGENTS.md was added.

## Updating this file

After meaningful work:

1. Check off completed to-do items or move them into the dated completed-work log.
2. Add newly discovered regressions, constraints, and open questions.
3. Update the current architecture if files, build steps, storage, hosting, or dependencies change.
4. Keep entries concise and factual; do not use this file as a raw session transcript.
