# Marks: reliable posting, live shared state, and traceable activity

You are the crit agent executing this prompt. Complete the implementation and verification in this riff repository; do not stop at a proposal. Read the riff rules at the top of `CLAUDE.md`, then `README.md`, `src/`, `public/`, and `spec/`. Nobody will answer questions during this run. Resolve unspecified details using the existing product principles and document your decisions.

## Goal and context

Keep Marks as a weekly conversation tree for a small room, including its distinctive 3D archive where moving left takes you into the past. Make changes visible to people using separate browsers, make their actions understandable from server logs, and fix the defects that damage permanent content, break weekly sealing, lose drafts, or block archive access.

According to the course schedule for 12 October 2026, this is crit 9 and this riff's `promptFor` is crit 10. Relevant briefs:

- [Crit 9 — All at once](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/api/crits/09-all-at-once.json): shared changes reach other open sessions within about one second, without a reload.
- [Crit 10 — Fly by instruments](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/api/crits/10-fly-by-instruments.json): distinguish people in separate browsers, enforce visibility and modification rules on the server, and explain their actions from server-side logs.

This is the riff copy. Follow the exceptions in the top block of `CLAUDE.md`; the graded repository's reflection and PROCESS requirements do not apply here.

The reviewed baseline is `a5448b9`. In a temporary copy with a separate SQLite database, `pnpm check` passed type checking and all 37 existing tests. The defects below expose gaps in that coverage. The deployed 3D archive renders normally and its list toggle works in ordinary use; preserve what already works.

## Preserve these product and technical decisions

- No accounts, passwords, email, or OAuth. A random first-party visitor cookie distinguishes anonymous browsers. A display name is a label, not an identity credential or proof of a real person.
- All marks are publicly readable. Visitors may append marks and replies during the current week. Past weeks are permanently read-only. Nobody can edit or delete posted marks.
- Keep `marks.parent_id`, the `weeks` chain, Monday 00:00 sealing in Australia/Sydney, DST calculations in `src/week.ts`, and lazy week creation on request.
- Keep one SQLite file on the Fly volume, `node:sqlite`, server-rendered HTML, no build step, and self-hosted three.js. Migrations must be additive and repeatable against existing data, without rewriting real marks' names or bodies.
- Home and mark pages must still support reading, posting, and replying with JavaScript disabled. The archive list must remain complete and usable when client enhancement fails.
- Escape user text on the server and use `textContent` or equivalent safe operations on the client. Never expose raw visitor identifiers in HTML, public APIs, live events, or client state.

## Priority 1: make the result of a submission trustworthy

### 1. Check sealing at the actual write time

Observed defect: `src/server.ts` captures `now` when a request arrives. After `handlePost()` awaits `readBody()`, it still passes that old time to `store.post()`. A request started on Sunday but completed after Monday midnight can append a reply to a week that has already sealed.

Implement the following:

- Determine the current week after the body has arrived and validation has completed, immediately before writing. Do not put asynchronous work between the sealing decision and the write.
- A home-page submission crossing the boundary belongs to the week current at write time. A reply addressed to a specific old-week mark must be rejected; do not silently move it to another parent.
- Explain the rejection, preserve the unpublished draft, and provide an explicit way to continue on the current week.
- Test with an injectable clock or test-only fixture. Do not ship a production request parameter that can override the clock.

Acceptance: a reply started Sunday at 23:59:59 and completed Monday at 00:00:01 is rejected and the old week's record count does not increase. A home-page post crossing the same boundary is stored only in the new week. Existing DST and ordinary sealing tests stay green.

### 2. Validate permanent content instead of silently truncating it

Observed defect: `src/server.ts` uses UTF-16 `slice()` on names and bodies. A name containing 39 ASCII `a` characters followed by `😀` splits the surrogate pair at the 40-unit limit. SQLite has already stored the damaged name when `encodeURIComponent()` in `src/cookies.ts` throws. This was reproduced against a temporary HTTP server: the response is 500, but the permanent mark exists and the name ends in `�`.

Implement the following:

- Choose and document a consistent length-counting rule, with matching browser guidance and server validation. Valid Unicode must never be split into invalid characters.
- Reject over-limit input explicitly and let the user correct it. Never silently shorten a name or body. Address predictable failures such as cookie encoding before they can produce a failure response after a successful permanent write.
- For ordinary-size invalid input, return server-rendered field errors and preserve the submitted name and body. Associate errors with their fields using appropriate `aria-invalid` and `aria-describedby` attributes.
- Preserve POST/redirect behavior for successful submissions. Replace the current silent 303 for whitespace-only or zero-width input with useful feedback. Do not depend on client validation.
- Return 413 for a body exceeding `MAX_REQUEST_BYTES`, rather than treating it as an internal 500. Store nothing. Full draft recovery is not required for oversized requests.

Acceptance: cover exact limits, over-limit input, emoji at name/body boundaries, whitespace, and zero-width characters. Failed submissions add no marks; ordinary validation failures retain the draft and explain the problem. Valid content is stored intact, and the response agrees with the actual write outcome.

## Priority 2: support simultaneous users and explain their actions from logs

### 3. Propagate shared changes in real time

Observed gap: home and mark pages are server-rendered only, while `public/archive.js` fetches `/archive.json` once at initialization. Another person's posts and replies do not update an already-open page. README still defers real-time updates to a later crit.

Implement the following:

- Add lightweight live propagation inside the existing Node service. Prefer SSE without a new dependency; explain any alternative in README. Do not introduce a separate service.
- After a successful write, update home-page marks, replies on relevant mark pages, reply counts, archive-list data, and archive-tree data within about one second. Failed or rejected requests must not be broadcast as successful changes.
- Calculate `mine` / “yours” separately for each receiving session. Never broadcast the posting visitor's personalized JSON unchanged to everyone else.
- Preserve drafts, focus, scroll position, archive selection, and the chosen tree/list view during updates. Do not implement this through whole-page reloads or replay the entire tree's growth animation on every change.
- Keep data synchronization independent of the 3D scene. With JavaScript enabled, list mode and WebGL failure must still receive live updates. Pausing GPU rendering must not stop data updates; resume the tree using the latest state.
- Recover authoritative state after a disconnect, catch up on missed events, deduplicate entries, and restore correct counts. Provide an understandable connection status. Concurrent appends must have a stable order and must not lose or duplicate marks.
- When open sessions cross into a new week, propagate the next lazy rollover and the old week's sealed state. Do not add a server timer for rollover. With JavaScript disabled, ordinary forms and manual refresh must still work fully.

Acceptance: use independent browser sessions A and B with separate cookies. A posts and B replies; the other person's already-open pages show the correct content and counts within about one second without reloading. Only the author's own session shows “yours”. A's activity must not clear B's draft. Reconnection catches up on changes made while disconnected, and concurrent appends are neither lost nor displayed twice.

### 4. Add durable, useful server-side activity logs

Observed gap: `src/server.ts` prints startup information and exceptions, but does not identify which visitor posted a mark, replied to which parent, or was rejected for which reason.

Implement the following:

- Record structured events with at least a timestamp, request correlation identifier, stable anonymous actor identifier, action, target mark / parent / week, outcome, and rejection reason. Derive the actor on the server from visitor identity; do not use a name as identity or output the raw cookie.
- Cover posting, replying, meaningful page visits, sealed-week rejection, missing parents, invalid input, and internal errors. Correlate internal errors with their requests while presenting an appropriate user-facing response.
- Write events to stdout so an operator can narrate from `flyctl logs`. Also persist them in an additive audit table in the same SQLite file so they remain queryable after restart. Commit successful mark writes and their successful audit records in the same transaction.
- Do not log raw cookies, complete user bodies, authentication configuration, or secrets. Serialize structured fields as JSON so user input cannot forge additional log lines. Avoid noisy events for every synchronization poll or heartbeat.
- Provide a server-local query method and brief instructions for filtering by actor, time, or mark. Do not expose a public audit-data download page or API.
- Explain the actual permission model in README: public reading; anonymous appending to the current week; no appending after sealing; no editing or deletion. Point to where the server enforces it and explain the limits of anonymous cookie identity.

Acceptance: logs alone distinguish A's and B's posts, replies, and rejected operations, including targets and reasons. Previous events remain queryable after restart. Public HTML, JSON, and live events contain no raw visitor IDs. Existing marks survive migration unchanged, and audit initialization is repeatable.

## Priority 3: keep the archive readable through failures and easy to navigate

### 5. Complete fallback handling and the scene lifecycle

Observed defects: `public/archive.js` enables `scene-on` before initialization, hiding the list, but its loading `try/catch` does not cover `startScene()`. Renderer initialization failure can leave the complete list hidden. Switching to list view only changes CSS; `archive-scene.js` keeps rendering and its ResizeObserver reads a hidden stage as 0×0, producing an invalid camera aspect ratio. Browser inspection confirmed a zero-width, zero-height canvas in list mode.

Implement the following:

- Make the entire initialization sequence recoverable. Keep the list accessible or provide an accessible loading state until the scene is ready; on failure, clean up partial initialization, restore the complete list, and show a one-line explanation.
- Give the candidate stage valid nonzero layout dimensions during initialization while keeping the list accessible. Simply delaying `scene-on` would leave the existing stage at `display:none` and reintroduce a 0×0 initialization defect.
- Recover from data-load failure, module-load failure, renderer initialization failure, and WebGL context loss. Do not leave unhandled exceptions or a blank page that remains “loading”.
- Pause unnecessary animation/GPU rendering in list mode, while the page is hidden, and when a scene is disposed. On resume, obtain valid dimensions before rendering. Ignore zero-width or zero-height resize measurements.
- Add appropriate pause, resume, and disposal behavior; release observers, event handlers, render loops, and GPU resources. Live updates must not accumulate obsolete scenes.
- Keep the selection, preview, camera, and URL consistent. If reduced motion is enabled during a flight, immediately finish positioning at the already-selected destination. The current implementation only clears the flight and leaves the camera partway there.

Acceptance: separately simulate JSON failure, module failure, scene-start failure, and context loss; every week and mark remains reachable through the list. Switch between tree and list at least five times without black screens, exceptions, or lost selection. Scene frame counts stop increasing in list mode. Enabling reduced motion during a flight immediately puts the selected node in view, matching the preview and URL.

### 6. Make empty weeks, mobile layouts, and keyboard navigation usable

Observed defects: the D-pad has only parent, siblings, home, and first reply. Down intentionally excludes the previous-week root. With an empty current week, those five buttons cannot lead into history. Keyboard users have dedicated week shortcuts, and users can select visible historical bubbles, but touch users lack an explicit week-navigation control. Author metadata and breadcrumbs also lack adequate long-name wrapping: a valid name of 40 `W` characters produced a 572px-wide page in a 390px viewport during local verification.

Implement the following:

- Add explicit Older week / Newer week buttons or an equally clear touch control using the existing week-navigation rules. Explain boundaries. Preserve “left means earlier” and the existing keyboard mappings.
- Using touch controls or Tab + Enter alone, allow navigation from an empty current week into every historical week and back. Tree shortcuts must not consume keys intended for focused navigation links or other controls.
- Fix wrapping/layout for long author names, metadata, breadcrumbs, previews, and bubbles so mobile pages do not overflow horizontally. Limit visual indentation for deep replies while retaining understandable hierarchy and access to every node.
- Wall links currently have accessible names such as “0 replies” for every mark. Keep counts but provide clear, distinguishable accessible names indicating which mark can be viewed and replied to.
- Remove dependence on the JavaScript call stack when rendering the complete archive list in `src/render.ts`. A scratch test with roughly 3,000 valid nested replies threw RangeError and made `/archive/` return 500. Traverse deep threads without crashing; do not silently discard existing marks to hide the defect.

Acceptance: use an empty current week plus at least two historical weeks to test touch/button navigation. Check 320px, 390×844, and desktop layouts with maximum-length names, unbroken body text, and at least ten reply levels: no horizontal scrolling, and all links and controls remain usable. Use additional temporary deep-chain stress data only to verify server-side archive HTML/JSON completeness and freedom from stack-overflow failures. Run one-second synchronization and browser interaction checks on normal room-size fixtures. If a very large or deep tree cannot be rendered safely in WebGL, explicitly fall back to the complete list; a 3,000-node scene is not required to maintain 60fps.

## Verification and handoff

- Fix submission/data consistency first, then real-time propagation and logging, then archive and accessibility behavior. If current rules need changing, update README's rationale and the rules below the divider in `CLAUDE.md`; preserve the top riff block exactly.
- Keep `spec/invariants.test.ts` unchanged and green. Add meaningful regression coverage for the actual defects, particularly slow requests crossing midnight, Unicode boundaries, draft preservation, independent sessions, durable logs, and real-time reconnection. Do not weaken valid existing assertions to get a passing result.
- Use a scratch `DATA_DIR` for every seed, stress fixture, and POST test. Never touch real `/data` or deployed marks. Start the application, run `pnpm check`, and verify upgrade/restart against an existing database.
- Verify home, mark, and archive pages in a real browser: keyboard, touch controls, JavaScript disabled, unavailable WebGL, initialization failure, reduced motion, and repeated tree/list switching. Pure tree-model tests cannot replace these interaction checks.
- Add a short README reproduction guide: two independent browsers operate the app while a third person narrates from logs only. Explain append ordering, reconnect behavior, and anonymous permission boundaries.
- Leave `agent/`, `.github/`, `fly.toml`, `reflections/`, `PROCESS.md`, the top riff block, and the original graded repository alone. Do not deploy or push.
- Make clear implementation commits and keep main deployable. Following the top riff rules, delete the executed `prompt.md` in your final commit. Report what was completed, which checks actually passed, and any verification limitations; never claim an unrun check passed.
