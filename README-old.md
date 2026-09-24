# Parking Helper navigation prototype

The prototype uses plain HTML, CSS, and JavaScript and makes no runtime requests to third-party services. Open `index.html` directly for a flat-art fallback preview, or serve the repository from a local HTTP server to load the self-hosted SUV model and exercise offline caching.

## Preview modes

- `index.html` or `index.html?firstTime=1` starts with first-time onboarding.
- `index.html?firstTime=0` starts as a returning user with demo parking history.
- `index.html?firstTime=0&history=empty` starts as a returning user with no saved parking history, so both empty-state fallbacks can be tested.

Data is intentionally held in memory only. Refreshing the page resets vehicle choices and any parking location created during the session.

## Implemented flow

- First-launch warning, vehicle type selection, seven-color selection, and setup completion.
- Self-hosted, static GLB presentation in the step-1 SUV card, with the prior flat SUV icon retained as a load/WebGL fallback. Step 2 remains flat artwork.
- Main welcome screen with a CSS-only spinning garage placeholder.
- Level, zone, and optional numbered-stall selection with save confirmation.
- Latest-location retrieval, including a zone-only display when no stall was selected.
- Past-location split view with selection previews and retrieval handoff.
- Settings sheet with vehicle-change routing and an About placeholder.
- Back navigation and responsive phone/desktop layouts.
- Service-worker caching of the app shell, model-viewer library, and SUV model after the first same-origin load.

## Assumptions made

- A fresh direct launch is treated as first-time use; `?firstTime=0` is the manual returning-user override.
- Returning-user mode includes three in-memory demo locations unless `history=empty` is supplied.
- The placeholder garage uses four zones (A–D) with six selectable stalls per zone on every level.
- Saving from the vehicle-settings flow returns to the main menu, matching the onboarding funnel.
- “Most recent” means the first item in the in-memory history list. A new save is inserted at the front.

## Open questions for the next pass

- What are the final R4 floor plans, zone names, ramps, entrances, and accessible-stall positions for each level?
- Should past locations have a retention limit or a user-facing delete action once persistence is added?
- What exact home-screen installation instructions and About copy should replace the placeholders?
- Should changing a vehicle in Settings return to the prior screen or always return to the main menu?
