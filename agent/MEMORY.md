# MEMORY

Durable self-knowledge, curated run by run; ephemeral state belongs in
`now.md`, not here.

## Environment quirks (this sandbox)

- `mise`-shimmed `pnpm`/`node` fail with "config.local.toml ... not trusted"
  until `mise trust /home/ben/.config/mise/config.local.toml` is run once per
  environment. That file holds Ben's real API tokens — read it only to
  confirm it's the expected, pre-existing secrets file before trusting it,
  never copy its contents anywhere, especially not into a course repo.
  `corepack pnpm <cmd>` works as a fallback before trust is established, but
  only for the initial `pnpm install` — `corepack pnpm check` (or any script
  that shells out to bare `pnpm` internally, as this template's `check` does)
  fails with a version-mismatch error, because corepack won't switch pnpm
  versions mid-script once it's already invoked one. Once `mise trust` has
  run, drop `corepack` entirely and call plain `pnpm` for everything else.
  Confirmed in `comp4020-crit2-bada` week 3.
- `agent-browser` needs `agent-browser install` once (downloads Chrome), and
  every `agent-browser open` needs `--args "--no-sandbox"` — Chromium's
  zygote sandbox doesn't work in this container and the browser otherwise
  fails to launch at all.
- `agent-browser screenshot <path> --full` — the flag is `--full` (or `-f`),
  NOT `--full-page`. The wrong flag gets silently treated as a second
  positional arg, and a stray file literally named `--full-page` lands in
  the cwd. Check `git status` for it before the first commit of a session.
- `agent-browser open <url> --viewport WxH` is not a real flag — `open --help`
  doesn't list it, and passing it doesn't error, it's just silently ignored,
  so two screenshots taken "at" 1920×1080 and 390×844 came back byte-identical
  (both at whatever the default viewport was) until I diffed the file sizes
  and noticed. The real command is `agent-browser set viewport <w> <h>`, kept
  for the rest of the browser session. Confirmed in `comp4020-crit1-bada`
  week 2: always sanity-check a "different viewport" screenshot pair actually
  differs (dimensions or at least file size) before trusting it as evidence a
  layout was checked at both marking viewports.
- Ordering matters for the above: call `set viewport` *after* the first
  `agent-browser open --args "--no-sandbox"`, not before. With no page open
  yet, `set viewport` tries to launch its own throwaway browser without the
  sandbox flag and dies on the same zygote error as an unflagged `open`.
  Confirmed in `comp4020-crit1-bada` week 2, ~46.5h-to-cutoff verification
  run: `open` first, then `set viewport`, then `screenshot`.
- Re-running the full `pnpm check` locally (not just CI) needs `CHROME_PATH`
  exported to the `agent-browser`-downloaded Chrome, or the Lighthouse spec
  errors outright (`chrome-launcher` can't auto-detect a system Chrome that
  doesn't exist in this sandbox) rather than being skipped:
  `export CHROME_PATH=$(find ~/.agent-browser/browsers -maxdepth 2 -iname
  'chrome*' -type d | head -1)/chrome`. CI doesn't need this — it has a real
  system Chrome. Confirmed in `comp4020-crit1-bada` week 2.
- `agent-browser`'s dark-mode/reduced-motion emulation is `set media dark`,
  not `media dark` — `--help` lists it under the `set` block (`media
  [dark|light] [reduced-motion]`) but a bare `agent-browser media dark`
  returns "Unknown command" without erroring loudly in a way that's easy to
  miss in a longer command chain. Same shape as the `set viewport` gotcha
  above: always confirm the subcommand needs the `set` prefix before trusting
  a one-off flag from the top-level help summary. Confirmed in
  `comp4020-ass1-bada` week 4.
- A real keyboard-only pass is checkable directly, not just inferable from
  markup: `agent-browser eval "document.activeElement.tagName + '#' +
  document.activeElement.id"` before/after repeated `agent-browser press Tab`
  reconstructs the actual tab order (and shows whether a `role="img"`/no-
  `tabindex` element is correctly skipped, vs. accidentally reachable or
  trapping focus); `agent-browser press ArrowRight` (or Left/Home/End) after
  focusing a specific element, then `eval` on the state it should have
  changed, confirms a native control's keyboard path actually drives the
  page rather than assuming "it's an `<input type=range>` so keyboard works
  for free." Used to confirm a pointer-drag affordance layered on top of an
  already-keyboard-accessible slider didn't need its own keyboard handling —
  a real check that turned up nothing to fix, which is a legitimate outcome,
  not a wasted one. Confirmed in `comp4020-ass1-bada` week 4.
- A hand-built `new PointerEvent(...)` dispatched via `agent-browser eval`
  with `document.dispatchEvent`/`window.dispatchEvent` does NOT route through
  a prior `element.setPointerCapture(pointerId)` call — the listener actually
  bound to that element never fires, so a synthetic "drag" silently does
  nothing while looking like it ran (no error, a plausible-looking readout
  left over from an earlier real event). This gave a false pass when
  re-testing a pointer-capture-based drag interaction mid-viewport-resize in
  `comp4020-ass1-bada` — the fix was to drive it with `agent-browser mouse
  move <x> <y>` / `mouse down` / `mouse up` instead, which are real synthetic
  input events the browser routes normally through pointer capture. Any test
  of a `setPointerCapture`-based drag must use `agent-browser mouse ...`, not
  a constructed-and-dispatched `PointerEvent`. Confirmed in
  `comp4020-ass1-bada` week 4, re-verifying against the production build
  (`vite preview`) rather than the dev server.
- `agent-browser mouse move/down/up` always dispatches with
  `event.pointerType === "mouse"`, even with `set device <touch-capable-name>`
  active first — device emulation changes viewport/UA/`hasTouch`, not what
  kind of pointer event the `mouse` commands generate. There is no CLI-level
  touch/swipe dispatch; the only touch-capable channel is a WebSocket
  `input_touch` message meant for the dashboard/MCP streaming surface, not a
  plain subcommand. So "does this actually work with a real touch drag" is
  not checkable from this CLI without building a client for that channel —
  confirmed by adding a temporary `pointerdown` listener recording
  `e.pointerType` before driving a `mouse` drag, at 390×844 against a
  production build, in `comp4020-ass1-bada` week 4. Don't spend time trying
  `set device` + `mouse` again expecting a touch-typed event.
- `gh` has no stored auth in this sandbox (`gh repo view`/`gh run list` both
  fail with "please run gh auth login", exit code 4) — so repo visibility and
  CI-run status aren't checkable that way here. `curl -s -o /dev/null -w
  "%{http_code}"` on the live Pages URL is the fallback for "has this repo
  shipped (gone public) and deployed yet" — a 404 there is expected and not a
  bug for as long as the repo is still private (doctrine: CI/Pages stays
  skipped pre-ship). Confirmed `comp4020-ass1-bada` week 4, 21h-to-cutoff run.
- `agent-browser screenshot --full` resizes the page to capture the full
  scrollable height, which fires a real `resize` event on `window` — if a
  `<canvas>`-based page has a resize handler that recomputes `canvas.width`/
  `canvas.height` from the element's layout box (the normal, correct way to
  keep a canvas crisp across viewport changes), setting those attributes
  clears the canvas's drawn content as a side effect of the HTML canvas spec,
  not a bug in the page. A `--full` screenshot taken right after drawing to a
  canvas can come back showing an empty canvas even though the draw call
  worked. Don't conclude "nothing rendered" from a `--full` screenshot of a
  canvas alone — cross-check with a plain `screenshot` (no `--full`, no
  resize) or with `ctx.getImageData(...)` on the specific pixel first. Found
  and confirmed this way in `comp4020-crit4-bada` week 5: `getImageData`
  showed the correct drawn colour at the exact drag coordinate while a
  `--full` screenshot taken moments later showed nothing, and a same-moment
  non-`--full` screenshot showed the dot correctly.
- A synthetic `PointerEvent` dispatched via `agent-browser eval` with a
  pointerId other than the real mouse's own makes
  `element.setPointerCapture(pointerId)` throw `NotFoundError: No active
  pointer with the given id is found` — Chromium's real mouse pointer is
  always pointerId `1` (so events built with `pointerId: 1` route through
  capture fine), but any other id (`2`, `3`, ...) isn't a real "active"
  pointer from the browser's perspective and throws. Use pointerId `1` when
  simulating the actual pointer via synthetic events. This also surfaces a
  production-code risk worth checking on any page that calls
  `setPointerCapture`: if it throws and runs *before* the code that actually
  starts the effect it's guarding (a sound, a drag, a draw), the whole
  handler aborts silently — wrap the capture call in try/catch so a capture
  failure degrades gracefully instead of eating the interaction. Found and
  fixed this way in `comp4020-crit4-bada` week 5 (`de810ef`): `setPointerCapture`
  ran before `startVoice` in the pointerdown handler, so a throw there would
  have hidden the hint text (already unconditional) while producing no sound
  at all — the exact silent-failure shape the crit's brief rules out.
- Reading a live `AudioParam.value` right after scheduling a
  `setTargetAtTime`/ramp doesn't confirm the automation is doing anything in
  this headless sandbox — `AudioContext.currentTime` never advances here
  without a real audio output device, so `.value` reads back as its initial
  value forever even when the scheduled automation is completely correct.
  Verify automation by tracing the *call* instead: monkey-patch
  `AudioParam.prototype.setTargetAtTime` (or whichever method) via an
  `--init-script`, same technique as patching `window.AudioContext` to count
  node creation, and read back the `target` argument each call was scheduled
  with. Confirmed in `comp4020-crit4-bada` week 5 (`de810ef`) verifying a
  speed-driven vibrato-depth parameter: `.gain.value` read `0` at every
  check, but the traced calls showed the correct target (~0.8 cents for a
  slow move, clamped to 40 cents for a fast one) — the feature worked, the
  read-back method was just the wrong probe.
- Course automation can rewrite a repo's course-owned surface mid-deliverable
  without the agent doing anything — `comp4020-crit4-bada` week 5 opened its
  fifth run to find a commit already sitting at the tip
  (`starter: bring the course-owned checks forward to the template tip`,
  `7da64d2`, authored by "COMP4020 course automation") that had landed
  between runs, dropping `oxlint`/`stylelint` out of `pnpm check`, rewriting
  `check-evidence.ts` to work offline, and adding a meta-description +
  og:image requirement to `spec/invariants.test.ts` plus a placeholder
  `public/card.png`. Nothing in the routine caused this; it showed up as
  already-committed history. Lesson: don't assume the check suite's shape
  (what `pnpm check` runs, what `check:evidence` requires) is stable across
  runs on a long-open deliverable — re-read `package.json`'s `check` script
  and `spec/README.md` each run rather than trusting a previous run's memory
  of what the checks cover, since the course side can move the goalposts
  forward without touching this repo's own commits.
- `agent-browser open ... --init-script <path>` takes a **file path**, not
  inline JS text — passing a JS string directly (e.g. to monkeypatch
  `OscillatorNode.prototype.start`/`.stop` for a call-counting check) silently
  no-ops: no error, the page loads fine, and the globals the script was
  supposed to set (`window.__starts`, etc.) just read back as `undefined`
  forever, which looks identical to "the script ran but the count stayed
  zero." Always `Write` the script to a temp file first and pass that path.
  Confirmed in `comp4020-crit4-bada` week 6: a rapid keyboard-retrigger check
  (5 fast keydown/keyup pairs on the same key, verifying start/stop counts
  match 1:1 with no stuck notes) read `typeof window.__starts === "undefined"`
  with the inline-string form and only started working once rewritten to a
  file path — same "looks-like-a-pass, isn't" shape as the earlier
  `AudioParam.value` read-back gotcha in this file, worth checking any
  `--init-script` invocation the same way before trusting a zero/undefined
  result.
- A browser session that already ran one `agent-browser eval`-dispatched
  interaction (a keydown, a click) is no longer in a true cold-open state for
  a *later* screenshot in the same session — any one-shot "before first
  interaction" flag the page sets (idle animation, hint text) has already
  flipped, so a screenshot taken afterwards shows the post-interaction page
  even though nothing was screenshotted in between. Looked like a rendering
  bug (idle glow and hint text both missing) in `comp4020-crit4-bada` week 6
  until re-running `agent-browser close` + a fresh `open` produced the actual
  cold view. Always open a fresh session (or verify no prior eval/dispatch
  ran in this one) before trusting a "does the cold-open state look right"
  screenshot.
- The `--init-script`-monkeypatch technique (see the entry above this one)
  generalises past tracing `AudioParam`/oscillator call arguments to counting
  node *creation and disposal*: patch `AudioContext.prototype.createOscillator
  /createGain/createBiquadFilter` etc. to increment a counter and wrap the
  returned node's `.stop`/equivalent to increment a second counter, then hold
  a note (or a chord) for several real seconds and diff the counts before vs.
  after. Confirmed clean (no growth, stop-count matched voice-count exactly)
  in `comp4020-crit4-bada` week 6 checking whether a long-held note or chord
  leaks nodes or drifts — a real check with a legitimate "found nothing"
  result, not a rubber stamp, since the technique would have caught actual
  growth had the code re-created nodes per frame for held notes.
- A sixth cold-open pass on `comp4020-crit4-bada` (run 11, week 6, `2fb9c06`)
  found a discoverability gap distinct from the earlier keyboard-hint-content
  bug in this file: at a 1280×577 viewport (a real laptop shape once browser
  chrome eats vertical space, not an exotic device), the hint `<p>` sat in
  normal page flow directly below a canvas sized `min(70vh, 32rem)` — on that
  viewport the two together don't fit above the fold, so the only visible
  pre-interaction affordance was the idle glow blob, with no scroll indicator
  hinting there's text below. A blind subagent playtest still managed to play
  the instrument (it tried mouse/keyboard regardless), but a stranger who
  needed the hint to know *which* keys work would have missed it entirely.
  Confirmed by comparing screenshots at 1280×577 (hint y≈584, viewport ends
  577) vs. 1366×768 (hint fully visible). Fixed by making the hint an
  `absolute`-positioned, `pointer-events: none` overlay inside a
  `position: relative` wrapper around the canvas, instead of a flow sibling
  below it — this guarantees the hint is visible whenever the play surface
  itself is, independent of page height/viewport, rather than trying to
  compute a canvas height that leaves just enough room. General check: any
  page whose primary interactive surface is viewport-height-relative
  (`vh`/`dvh` sizing) and has a *second*, separate element a stranger needs
  to see before interacting (a hint, a call-to-action) should overlay that
  element on the primary surface rather than stack it in flow after — stacking
  only works for viewports at least as tall as the one it was eyeballed at.
- Sandbox quirk, not project-specific: a `pnpm dev &`-style background job
  started via one Bash tool call is not reliably visible to `jobs -l`/`kill
  %1` in a *later*, separate Bash tool call in the same session — each Bash
  invocation can get a fresh subshell, so job-control state doesn't carry
  over the way it would in one continuous interactive terminal. `jobs -l`
  came back empty and `kill %1` silently no-op'd on a vite dev server that
  was still very much running and serving requests (confirmed via `curl` and
  `ps aux | grep vite`) in `comp4020-crit4-bada` run 11. Always verify a dev
  server is actually stopped by PID (`ps aux | grep <tool>` then `kill <pid>`,
  then re-`curl`/re-`ps` to confirm) rather than trusting `jobs -l`/`kill %N`
  to have found it, when "dev server was shut down" needs to be true, not
  just attempted.
- Running `agent-browser` directly in the main run's own shell *while* a
  background subagent's prompt also tells it to drive `agent-browser`
  against the same local dev-server URL produces a corrupted report from
  the subagent — they contend for the same underlying browser
  instance/session rather than each getting an isolated one. In
  `comp4020-crit5-bada` week 6, a "blind cold-open playtest" subagent was
  launched in the background at the same moment the main run started using
  `agent-browser` itself (screenshotting mid-play frames to build a link-
  preview card) against the same `localhost:5183` dev server. The subagent's
  report came back describing behaviour that flatly contradicted the source
  and the actual live page — "the game auto-starts on page load with no
  click needed" and "ArrowUp and Enter do nothing at all" — both falsified
  within seconds by opening a fresh session serially afterward (a true cold
  open sat at score 0 doing nothing until input; ArrowUp and Enter both
  jumped and scored exactly like Space). The most likely cause: the main
  run's concurrent screenshot/keypress traffic bled into what the subagent's
  own `agent-browser` calls were observing, so it was reporting on a
  contended, cross-talking session, not a real isolated cold-open one. One
  claim from the same corrupted report *did* independently reproduce by hand
  afterward (a restart press leaving the score readout frozen at the dead
  run's number) — so a corrupted report isn't necessarily 100% fabricated,
  but nothing in it can be trusted without a serial, single-session
  re-check. General rule: never drive `agent-browser` from the main thread
  while a background subagent's task also drives `agent-browser` at the
  same URL/port — either wait for the subagent to finish before touching
  the browser yourself, or give it a separate dev-server port so the two
  sessions can't collide.
- `pkill -f "<pattern>"` can match only the wrapper shell process a
  background job was launched under, not the real long-running process it
  execs — a `pnpm dev &`-style background start with `run_in_background`
  shows up in `ps aux` as `sh -c vite --port 5185`, so `pkill -f "vite
  --port 5185"` kills that wrapper (which the pattern matches) while the
  actual `node .../vite.js --port 5185` child it spawned keeps running and
  keeps the port listening — `curl` to the port still returns 200 after the
  "kill" with no error from `pkill` itself. Confirmed in
  `comp4020-crit5-bada` week 6, run 5. Always verify a dev server is truly
  down by re-`curl`ing (or `ss -ltnp`/`lsof -i :<port>` for the real
  listening PID) after any kill, the same discipline already recorded above
  for `jobs -l`/`kill %1` not finding a backgrounded job — and if the target
  process is still there, resolve the actual listening PID from `ss`/`lsof`
  and `kill` that PID directly rather than retrying the same `pkill -f`
  pattern.
- The `agent-browser` daemon can silently restart itself mid-session
  ("Daemon version mismatch detected, restarting...") after several quick
  separate CLI calls (`eval`/`press`/`open` in a tight loop), and the
  restarted daemon does *not* remember `--args "--no-sandbox"` from the
  `open` that started the original session — the very next `open` (even to
  the same URL) fails outright with the zygote-sandbox `FATAL` error this
  file already documents, even though nothing about the sandbox itself
  changed. It looks like an unrelated regression of the original
  no-sandbox fix but isn't. Fix: `pkill -f agent-browser` to clear the
  stray daemon, then re-`open` with `--args "--no-sandbox"` again. Better
  prevention: batch a multi-step timed check into one `eval --stdin`
  script (using in-page `setTimeout`/`sleep`-via-promise and
  `KeyboardEvent`/`performance.now()`) instead of many separate quick CLI
  round-trips, which both avoids triggering the restart and is more
  precise for timing-sensitive checks anyway. Confirmed in
  `comp4020-crit5-bada` week 6, run 9, verifying a death→restart cooldown
  window (dispatched `keydown Space` to start a run, waited for a real
  death, tried an immediate restart — correctly blocked — then one after
  the 0.6s cooldown — correctly allowed — all inside one `eval` call).

- `agent-browser tab switch t1` is not valid syntax --- `tab --help` shows
  no "switch" keyword; the command is `agent-browser tab <t1|label|target>`
  directly. `tab switch t1` errors with "No tab with label 'switch'", and if
  it's one line in a longer batch, the *next* command in that batch silently
  keeps running against whichever tab was already active rather than the
  one you meant to switch to. In `comp4020-crit7-bada` week 1 this
  accidentally sent a booking-form submit to tab t2 instead of t1 --- no
  lasting harm here since it happened to double as a real test of the
  cross-tab SSE update (t1's own `EventSource` live-patched to "Full" with
  no reload, confirming the feature), but don't rely on an accidental
  mis-target to double as a test; fix the syntax and drive tabs
  deliberately.

- Fly's `auto_stop_machines` doesn't stop a machine while any connection is
  still open --- confirmed on `comp4020-crit7-bada` (week 8) by watching
  `flyctl status` hold `started` for 14+ minutes with one SSE tab open, then
  drop to `stopped` within about a minute of closing it. That reframes any
  "does the live SSE connection survive the machine auto-stop cycle"
  question: an open tab can't be sitting there *while* the machine stops out
  from under it, because the open stream itself is what prevents the stop.
  The real risk one level over is the *reconnect* gap: a plain in-memory
  `EventEmitter`/pub-sub bus (no backlog) plus a bare `new EventSource(url)`
  client with no resync-on-reconnect logic means any disconnect --- a network
  blip, or *every* Fly redeploy, which restarts the machine and drops every
  open SSE connection --- followed by the browser's automatic reconnect
  leaves a tab subscribed only to *future* events, silently missing anything
  that happened during the gap until a manual reload. Reproduced concretely
  against a local dev server (never against live production booking data,
  which had no delete/cancel, so a test booking there would've been a
  permanent, visible piece of junk at the crit): kill the server process,
  restart it, and fire the state-changing request within ~1ms of the port
  responding again --- well inside the browser's ~3s default `EventSource`
  retry delay --- and the already-open tab keeps showing the stale value
  indefinitely (readyState back to OPEN, zero errors, looks completely
  healthy) even though the underlying data changed. Fixed generally: have
  the SSE endpoint's connection-open handler enqueue one full-state snapshot
  message (matching whatever shape the client already parses per update) for
  every current entity, *before* subscribing to the live bus, so every
  connect and every reconnect gets a same-value no-op or a corrective resync
  automatically, no client-side change needed. Re-ran the identical tight
  race against the fix and the tab picked up the true state immediately.
  General check for any SSE/live-update feature backed by a backlog-less bus:
  don't just test "does a message sent while connected arrive" (the standard
  spec-test shape, e.g. `spec/bookings.test.ts`'s own broadcast test) — test
  "does a message sent during a disconnect-then-reconnect gap ever arrive,"
  since those are different guarantees and only the second one is what
  "every open tab sees the truth" actually requires.

- The SSE-resync fix above was only ever verified against a killed-and-
  restarted local dev process; the next run on `comp4020-crit7-bada` (week 8,
  run 6) closed that gap by verifying it against a real `flyctl deploy`
  against production. Technique: open the live `*.fly.dev` URL with
  `agent-browser --init-script` wrapping `window.EventSource` in a `Proxy`
  that logs every `open`/`message`/`error` event with a timestamp to
  `window.__sseLog` (needs the file-path form of `--init-script`, per the
  existing gotcha in this file — an inline string silently no-ops), confirmed
  the initial 5-session snapshot arrived on connect, then ran a real
  `flyctl deploy --remote-only --ha=false` against the *already-deployed*
  commit (a harmless no-op redeploy, not a code change) while the tab stayed
  open. The trace showed a real `error` event (readyState 0) ~1 minute in as
  the machine restarted, then the browser's own automatic reconnect firing
  `open` plus a fresh 5-message snapshot ~16s later — confirming the
  resync fires over Fly's real rolling-deploy machine-restart path, not just
  a local `kill`/restart of the dev process, which is a different (if
  related) failure mode. No code change needed; this was pure verification
  of an already-shipped fix. General technique: this generalises the
  monkeypatch-via-`--init-script` tracing pattern used elsewhere in this file
  for `AudioParam`/oscillator calls to browser-native network primitives
  (`EventSource`, presumably also `fetch`/`WebSocket`) via a `Proxy` around
  the constructor — useful whenever "does X survive a real reconnect/retry"
  needs a timestamped event log rather than a single before/after snapshot.
- A second blind cold-open pass on `comp4020-crit7-bada` (week 8, run 6),
  same source-inaccessible subagent protocol as run 3, against the local dev
  server (never production, which still has no delete/cancel) came back
  clean again — purpose obvious unaided, booking persists on reload,
  duplicate/full/empty-name error cases all handled clearly, live two-tab
  sync confirmed within ~3.4s, mobile viewport clean, full keyboard-only
  flow worked end to end, zero console errors. One soft nitpick flagged (a
  stale success banner lingering after a blocked empty-field submit) turned
  out not to be a bug on inspection: the notice banner is server-rendered
  from a `?booked=1`/`?error=...` query param on a traditional full-page-
  reload form, and a submission blocked by native HTML5 `required`
  validation never navigates at all — no request is sent, so the page never
  re-renders, so of course the old banner is still the DOM's last real
  state. Nothing false is being claimed; the banner accurately reflects the
  last real server response. Logged as a second consecutive clean pass, same
  calibration point as the crit-4/crit-5 "sixth clean pass is legitimate
  evidence, not proof of an inadequate test" lesson elsewhere in this file —
  don't force a bug into existence to justify the testing round.
- A seventh `comp4020-crit7-bada` run (week 8) tried a code-level edge case
  a playtest can't reach: `bookings.ts`'s `POST` handler calls
  `bus.emit("booking", ...)` synchronously, outside the transaction, right
  after a successful `bookSession` — and `events.ts`'s listener calls
  `controller.enqueue(...)` directly, with no try/catch. Node's
  `EventEmitter.emit` is synchronous, so a throw inside any one listener
  (e.g. from writing to a tab whose connection just died) would propagate
  straight back into the POST handler *after the booking had already
  committed* — a worse failure than a lost broadcast, since the user would
  see a 500 for a booking that actually succeeded, and any listener
  registered after the throwing one would miss the event entirely. Tested
  for real with a raw `net.Socket` (not `agent-browser` — this is a
  server-side Node question, not a browser one): opened a real SSE
  connection with a bare TCP socket, then `socket.resetAndDestroy()`'d it
  (a genuine RST, not a graceful FIN) with zero delay before immediately
  firing a booking, to catch the narrowest possible window before the
  server could notice the disconnect. No throw, no 500, other tabs
  unaffected — `controller.enqueue()` only queues into the stream, it
  doesn't synchronously write to the socket, so a dead connection surfaces
  as an async stream error, never a synchronous throw back through
  `emit()`. Went one step further to check for a *slower* failure mode
  (a leaked listener/orphaned `setInterval` if `cancel()` never fires for
  an RST specifically, since `cancel()` is normally documented for
  cooperative unsubscribes like `reader.cancel()`): temporarily added
  `console.error` tracing to `start()`/`cancel()` (reverted before
  committing, never shipped) and confirmed via `astro dev logs` — not the
  wrapper process's own stdout, since `astro dev` daemonizes and forking
  the visible CLI process's log misses the real server output entirely —
  that every abrupt-RST connection still gets a `cancel()` call and the
  listener count returns to exactly 0 every time. Confirmed clean, no code
  change. General technique for any future SSE/EventEmitter-based
  broadcast: test the disconnect path with a raw socket RST, not just
  `reader.cancel()` or closing the fetch response — they exercise
  different code paths, and only the raw-socket route asks the real
  question of what an actual dropped connection (not a cooperative one)
  does to the emit()/enqueue() chain.
- An eighth `comp4020-crit7-bada` run (week 8) tried a different angle after
  two clean cold-opens, a verified SSE-resync fix, and a verified-clean
  RST-disconnect edge case: a formal real-browser accessibility pass, which
  no prior run on this repo had done. `agent-browser a11y <url> --json` is a
  built-in axe-core runner (no need to fetch axe-core from a CDN and pipe it
  through `eval --stdin`, the technique this file documents for projects
  without that command) — ran it against both pages (`/`, `/readme/`) at
  both a desktop and the 390×844 mobile viewport: 0 violations, 0
  `incomplete` every time, including for colour contrast, which a real
  browser (unlike jsdom) can actually resolve. Followed with a real keyboard
  interaction test the axe scan itself can't do: focused the first session's
  name input, typed via `agent-browser keyboard type` (real keystrokes, not
  `.value =`), submitted with `agent-browser press Enter` (no click, no JS
  shortcut), and confirmed the booking landed (`?booked=1` redirect, name
  present in the DOM) — the native `<form method="post">` really does work
  keyboard-only end to end. Then tabbed from a fresh cold load
  (`agent-browser press Tab` + reading `document.activeElement` and its
  computed `outlineStyle`, the same technique already documented in this
  file for reconstructing tab order): nav links, then straight into the
  first open session's name input and book button, every stop showing a
  visible outline — no `all: unset`-style reset stripping focus visibility
  anywhere on this page, unlike the theme-level bug found on
  `comp4020-ass2-bada`. All clean, no code change — a real checked result
  (the same calibration as the two-clean-cold-opens entries elsewhere in
  this file: a formal a11y/keyboard pass that finds nothing is legitimate
  evidence once several other angles are already covered, not proof the
  check was too shallow). Worth remembering `agent-browser a11y` as the
  first thing to reach for over the manual CDN-fetch-and-eval technique on
  any future deliverable, only falling back to the manual route if `a11y`
  isn't available or doesn't cover what's needed (e.g. scoping to one
  `--selector`, or `--tags` for a specific WCAG level).
- A ninth `comp4020-crit7-bada` run (week 8, `36417f9`) found a second layer
  under the case-fold duplicate-name fix (`dc0d99a`): SQLite's built-in
  `lower()` only folds ASCII, so the generated `person_name_key` column and
  the app-level JS `.trim().toLowerCase()` pre-check in `bookSession`
  quietly disagreed on any non-ASCII name — booking "FRANÇOIS" then
  "françois" into the same capacity-2 session succeeded as two different
  people both at the app-level pre-check *and* the unique index itself
  (each side folds the accented character differently, so neither ever sees
  a collision), overbooking a session the schema's own comment says can
  never overbook. Confirmed with a vitest probe calling `bookSession`
  directly before touching the schema, the same escalation-order as the
  ASCII case-fold bug: verify empirically before design work. Real-world
  relevance for an ANU-context app: French/Vietnamese/Spanish/Nordic names
  with diacritics are common among the actual student population this app
  models. Fixed by registering a custom deterministic SQL function
  (`client.function("name_key", { deterministic: true }, (name) =>
  String(name).trim().toLowerCase())`, better-sqlite3's API) and pointing
  the generated column at it instead of built-in `lower(trim(...))`, so both
  sides fold case identically by construction rather than by coincidence.
  General lesson for any schema mixing a SQL-computed key with an
  app-level pre-check meant to mirror it: don't assume a built-in SQL string
  function agrees with the host language's equivalent for non-ASCII input —
  verify with a throwaway probe (`db.prepare("select lower('FRANÇOIS')")`)
  before trusting the two stay in sync, and if they don't, back the
  generated column with a custom function built from the *same* host-language
  call the app already makes, rather than hand-porting Unicode case-folding
  rules into SQL. Second, sharper gotcha hit generating the migration:
  `drizzle-kit generate` for a change to a generated column's *expression*
  (not just its mode) emitted `ALTER TABLE ... DROP COLUMN person_name_key`
  before dropping the unique index that references that column — SQLite
  rejects this outright (`error in index ... after drop column: no such
  column`), confirmed by booting the built server against the migration
  and getting a 500 on every request, not a boot-time crash (astro's build
  succeeds; the migration only runs lazily on first `getModuleForRoute`).
  Fixed by hand-editing the generated migration to `DROP INDEX` first, then
  `DROP COLUMN`/`ADD ... GENERATED`, then `CREATE UNIQUE INDEX` again —
  drizzle-kit does not order these safely on its own for SQLite, so any
  future change to a *generated* column's expression on a column that's
  also indexed needs this same manual reordering, not just the earlier
  `stored`-vs-`virtual` mode gotcha already in this file. Verified the real
  upgrade path end to end before deploying: booted a throwaway DB through
  the *old* migration set, booked a real "FRANÇOIS" row via the actual
  built server's `/api/bookings` POST endpoint (needs an `Origin` header
  matching the request URL — Astro's CSRF check 403s a bare `curl` POST
  with none), then rebooted the *new* build against that same database
  file and confirmed the migration applied cleanly and a same-person
  differently-cased booking now correctly redirects to
  `?error=duplicate`. Also re-verified live against production before
  deploying (`flyctl machine start` + `flyctl ssh console` running a
  `node -e` one-liner against `better-sqlite3`, same technique as the
  previous run) that the volume still held zero real bookings, so the new
  index couldn't conflict with anything already on disk. One test-authoring
  gotcha worth its own line: this repo's `spec/bookings.test.ts` tests run
  sequentially against one shared seeded database and several tests assume
  whatever session `findSessionWithSpareCapacity()` returns is otherwise
  *empty* (computing filler counts as `capacity - 1`, not
  `capacity - booked - 1`) — a new test inserted earlier in the file that
  leaves its own session partially booked (rather than fully filling or
  fully avoiding it) silently breaks a *later* test's arithmetic with no
  connection to what that later test is actually about, surfacing as a
  confusing "expected 1 booking slot, got 0" failure in a next-door race
  test. Fixed by making the new test fill any seats it didn't use itself
  before returning, matching the existing convention. General check for
  this style of shared-server spec suite: any new test that touches a
  session found via a shared "find one with spare capacity" helper must
  leave that session either fully consumed or account for its own
  contribution in a `booked`-aware way — never assume a later test's naïve
  `capacity - 1` filler math is someone else's problem to keep working.
- A tenth `comp4020-crit7-bada` run (week 8, `235ee89`) deliberately rotated
  away from the name-key/case-fold family (three layers deep already —
  ASCII, non-ASCII, NFC/NFD normalization) after the previous run's own
  hand-off flagged three-in-a-row on one bug family as a signal to look
  elsewhere, not confirmation to keep drilling. Landed on a different,
  previously-uncovered code path with the same underlying method (verify
  what the app's own validation actually accepts, not what it's meant to):
  `bookings.ts`'s emptiness check was `!personName` on a `.trim()`-ed
  string, but JS `.trim()` only strips whitespace (Unicode category `Zs`),
  not zero-width/format characters (`Cf`, e.g. U+200B zero-width space) —
  confirmed with `"​".trim().length === 1`, not `0`. A real browser's
  own HTML5 `required` attribute has the identical gap (it only checks
  `value !== ""`), so a name made of nothing but invisible characters
  passed both the client-side `required` guard and the server-side check,
  silently taking a real seat while displaying as nothing at all in the
  attendee list — worse than the seat just staying open, since this app's
  whole selling point is an honest, visible attendee list. No test had ever
  exercised `error=invalid` at all before this run, not even the plain-blank
  case. Fixed by checking `/[^\s\p{Cf}]/u.test(personName)` alongside the
  existing checks, and added a third test confirming a name that merely
  *contains* one ZWSP alongside real characters still books successfully,
  so the fix doesn't overreach into rejecting legitimate names. Also
  checked and found clean, worth not re-checking: SQLite foreign keys
  (`bookings.session_id`, `sessions.course_id`) are enforced by default in
  this environment's `better-sqlite3` (13.0.3) with no explicit `PRAGMA
  foreign_keys = ON` anywhere in `db.ts` — verified with a scratch DB and a
  raw `INSERT` against a bogus `session_id`, which failed with `FOREIGN KEY
  constraint failed` regardless of whether the pragma was set explicitly.
  General technique for any deliverable whose validation logic mixes a
  client-side HTML guard (`required`, `pattern`) with a server-side mirror
  of the same rule: check whether both sides agree on what "empty"/"valid"
  means using the *language's* actual definition (JS `.trim()`'s whitespace
  set, HTML's `value !== ""`), not the intuitive one — the same class of
  gap as the ASCII-only `lower()` bug, just one level earlier in the
  pipeline (presence, not case-folding).
- An eleventh `comp4020-crit7-bada` run (week 8, `35cfd68`) rotated away from
  the name-key/case-fold/emptiness family (four layers deep across the prior
  three runs) onto the read path instead, per the previous hand-off's
  explicit suggestion. Found: `db.ts`'s two attendee-listing queries
  (`listSessions`'s per-session `bookedBy`, and the identical shape inside
  `bookSession`'s transaction building the SSE broadcast payload) had no
  `ORDER BY` at all, so their row order was whatever SQLite's query planner
  happened to produce — confirmed via `EXPLAIN QUERY PLAN` on a hand-built
  scratch DB (schema + `name_key()` function + the real unique index
  reproduced from `schema.ts`) that a plain `WHERE session_id = ?` query with
  no explicit order gets satisfied by walking the `(session_id,
  person_name_key)` unique index, returning rows sorted by folded name, not
  by insertion/signup order. Not a crash and no capacity/duplicate violation
  (the actual contract test's own focus), but a real drift from "who's
  booked, in the order they booked" — and nothing guaranteed the two
  identically-shaped queries would keep agreeing with each other either, so
  a future index/schema change could make the page and the SSE broadcast
  silently disagree on attendee order for the same session. Fixed with an
  explicit `.orderBy(bookings.id)` on both queries (cheap, no migration).
  Verified two ways before committing: a new regression test booking two
  names in reverse-alphabetical signup order ("Zeta Booker" then "Beta
  Booker") and asserting the rendered page lists Zeta first; and, separately,
  the identical two-name booking sequence against a real `pnpm dev` server
  on a dedicated port with a fresh throwaway DB, reading the rendered HTML
  back with `curl` to confirm the fix holds in a real running server, not
  just the JSDOM-based spec harness. Deliberately did *not* repeat that same
  booking sequence against live production to verify there too — unlike the
  ZWSP/empty-name fix two runs prior (which is safe to verify live since a
  rejected booking never takes a real seat), this fix can only be observed
  by actually booking real seats, and this app has no delete/cancel, so
  doing that on the shared production volume would leave permanent junk
  data for a cosmetic-only bug. Confirmed instead that all five seeded
  sessions still read `0 booked` on the live URL after deploying, i.e. the
  deploy shipped clean with no side effect. General technique: for any bug
  whose only live-visible symptom is "state changes permanently and there's
  no way to undo it" (as opposed to a rejected request, which leaves no
  trace), the standing "verify against real production" discipline in this
  file has a real exception — verify against a fresh local server instead,
  and settle for confirming production's *existing* state is unperturbed by
  the deploy itself.
- The finishing run on `comp4020-crit7-bada` (week 8, `24765ba`) caught a
  case the standing "reflection heading drift"/"process-account drift"
  lessons in this file predict but hadn't yet turned up on this deliverable:
  a project's own README asserted "a unique constraint on `(session_id,
  person_name)`," a claim that was true when first written but had been
  silently overtaken by three later deepen-run schema fixes
  (`dc0d99a`/`36417f9`/`9cf3082`) that moved the real constraint onto a
  generated, case-folded, normalized `person_name_key` column --- nothing
  broke and no check caught it, since the README's prose isn't executable.
  Found only by rereading the README's own bulleted claims against the
  current `schema.ts` at the finishing pass, the same discipline already
  used for doctrine-vs-reflection-heading drift. General check: at the
  finishing run on any deliverable whose README/spec makes a specific claim
  about a schema/constraint/algorithm, diff that claim against the current
  implementation one more time before shipping --- a claim written accurately
  early in a multi-week deepen doesn't stay accurate for free just because
  nothing failed.

- `docker` in this sandbox needs `sudo`: `ben` is in the `sudo` group but not
  `docker`, and the socket is `root:docker` group-owned, so a plain
  `docker build`/`docker run` fails with "permission denied ... docker.sock"
  even though `docker` itself is on PATH. `sudo docker build`/`sudo docker
  run` work fine. Worth doing a real local `docker build` + `docker run` +
  `docker restart` (or a kill+restart) before ever deploying to Fly when a
  deliverable's core claim is "persists across a restart/redeploy" --- it's
  the same guarantee the Fly volume is meant to provide, checked directly
  against the actual Dockerfile rather than assumed from reading `fly.toml`.
  Confirmed useful in `comp4020-final-bada` week 9 verifying a SQLite-file-
  on-volume design before the first deploy.
- This course's GitHub org for crit/deliverable repos is
  `comp4020-agentic-coding-studio`, confirmed via `git remote -v`, NOT
  `comp4020` --- the latter is what a plausible-looking guess (or the
  template's own placeholder `YOUR-ORG/YOUR-REPO` in `PROCESS.md`) would
  produce. Always run `git remote -v` before writing a `PROCESS.md` commit
  citation link, never infer the org from the repo name pattern or a prior
  deliverable's URL --- confirmed in `comp4020-final-bada` week 9, and
  consistent with the standing "check:evidence never validates the URL,
  only the SHA" lesson elsewhere in this file.

- `pkill -f "<pattern>"` inside a Bash tool call whose own command line
  contains that same pattern kills the tool's shell itself (exit 144, and
  every later statement in the call silently doesn't run). Kill by the
  listening PID from `ss -ltnp | grep :<port>` instead. Confirmed in
  `comp4020-final-bada` week 10.

- `comp4020-final-bada`'s `pnpm check` runs its specs against a *running*
  app (`spec/global-setup.ts`), so with nothing listening it fails with "No
  test files found" plus "nothing is answering at :8080", which looks like a
  broken config but isn't. Start one first on a throwaway dir:
  `DATA_DIR=$(mktemp -d) PORT=8091 node src/server.ts &`, then
  `APP_URL=http://localhost:8091 pnpm check`, then kill the PID from
  `ss -ltnp`.

- Load-checking an SSE app needs no browser: a Node script opening N
  `fetch('/events')` streams (each with its own `visitor=` cookie), parsing
  `data:` lines off `r.body`, then timing POSTs against arrival. On
  `comp4020-final-bada` (crit 9), 60 listeners got all 15 marks, worst
  267 ms, ~92 MB RSS. One run of this is enough; it came back clean.

- Two isolated browser profiles (a crit's "separate Chrome profiles"):
  `agent-browser --session a open ...` / `--session b ...` gives each its
  own cookie jar. Confirmed in `comp4020-final-bada` crit 10.
- `flyctl status` prints the machine version as a bare number in a
  `VERSION` column, not `vNN`. A deploy-wait loop grepping `v[0-9]+`
  never matches. Use the `LAST UPDATED` timestamp instead.

## Repo-independent lessons

- stylelint-config-standard rejects BEM double-underscore class names
  (`selector-class-pattern` wants plain kebab-case) and flags a lower-
  specificity selector (e.g. bare `a`) that comes *after* a higher-specificity
  one targeting overlapping elements (`no-descending-specificity`) — write
  generic element rules before scoped/attribute-selector rules that touch the
  same elements, not after.
- Before trusting a commit message, run `git show --stat HEAD` (or check
  `git status --short` immediately before committing). A `git add` with a
  stale pathspec can silently stage far less than intended while the commit
  message you'd already drafted describes the full intended diff — the
  message and the diff can drift apart without any command erroring loudly.
  Caught this once in `comp4020-crit1-bada` week 1
  (`5fedd84` vs the corrective `bfd0d1c`); worth the extra `git show --stat`
  every time from now on, not just when something feels off.
- A visual layout that looks reasonable in the diff can still be wrong at the
  marking viewport — a 2-column CSS grid gallery had an ugly reflow gap next
  to a tall image that was only obvious from an actual `agent-browser`
  screenshot at 1920×1080, not from reading the CSS. Always screenshot at
  both marking viewports before calling a layout done, not just after
  finishing all the CSS.
- `agent-browser eval --stdin` accepts a multi-KB script via heredoc — piping
  a whole minified library (e.g. `axe-core/axe.min.js`) followed by an
  `(async () => { ...; return JSON.stringify(...); })()` IIFE is how to run a
  real accessibility audit in an actual browser from the CLI, when the
  library is too big for a plain `eval "<js>"` positional arg. `eval` awaits a
  returned promise automatically.
- axe-core's `color-contrast` rule can't resolve inside jsdom (no layout
  engine) — it reports `incomplete`, never pass/fail, especially behind any
  gradient/pattern background. An axe-in-jsdom test should assert zero
  *violations*, not zero `incomplete`; verify contrast separately, either a
  real-browser axe run (see the `agent-browser eval --stdin` trick above) or
  by hand via the WCAG relative-luminance formula. Also sanity-check any such
  harness against a deliberately broken fixture (missing `alt`, empty link)
  before trusting a clean result on the real site — confirmed useful in
  `comp4020-crit1-bada` week 1.
- The `color-contrast` incomplete result isn't only a jsdom limitation — a
  *real-browser* axe run also reports `incomplete` (not pass/fail) for text
  positioned over a `<canvas>`/`<img>`, because axe can't sample a canvas's
  drawn pixels as a "background colour" the way it can a flat CSS colour.
  Same fix as the jsdom case: verify by hand instead of trusting the
  incomplete flag either way. For text over an *animated* canvas
  specifically, the useful hand-check isn't a static luminance formula on one
  frame — it's sampling the actual drawn pixel at the text's exact position
  across the full animation (`ctx.getImageData` inside a
  `requestAnimationFrame` loop via `agent-browser eval --stdin`, run for a
  few seconds to cover the animation's periods) and computing WCAG contrast
  against the worst pixel actually seen, not the worst pixel a quick mental
  estimate assumes. Confirmed in `comp4020-crit4-bada` week 7: a manual
  full-alpha estimate suggested the idle-glow animation could dip hint-text
  contrast to ~3.9:1 (below AA) if the glow's radial gradient ever passed
  fully behind the hint's overlay position, but 361-frame samples at three
  viewports (1280×577 default, 1920×1080, 390×844) never saw the glow reach
  that pixel above background at all — worst measured ratio was 7.11:1, and
  a corrected analytical pass (accounting for the gradient's actual radius
  and alpha falloff at that specific distance) matched the empirical result.
  A real, verified "no bug here" outcome, not a rubber stamp: the full-alpha
  assumption was a genuine plausible failure mode had the glow's geometry
  been different, and only pixel sampling (not axe, not a spec test)
  distinguishes a real dip from a hypothetical one.
- A prior run's memory claiming work is "not yet pushed" can be stale — one
  run in `comp4020-crit1-bada` recorded that note, but the next run's
  `git fetch` + `git status` showed `origin/main` already matched `HEAD`
  exactly. `git status`'s "up to date" line only reflects the locally cached
  `refs/remotes/origin/*`, which doesn't update without a fetch — always
  `git fetch` before trusting any claim (including your own memory's) about
  what has or hasn't been pushed.
- Doctrine says a reflection is headed with the course source's *title*,
  never a week number, since week counts drift but the title doesn't — but
  `reflections/crit-1.md` sat headed "Week 1: the forgotten web" through
  several verification-only runs before one actually re-read the doctrine
  line against the file instead of just checking it existed and cited real
  commits. `pnpm check:evidence` only checks the filename and that citations
  resolve — it does not check the heading text, so this class of drift is
  invisible to the automated sensor and only catchable by re-reading the
  doctrine text against the file by hand. Fixed in `comp4020-crit1-bada`
  week 1 (`368d730`). Worth doing once per deliverable: re-read the doctrine's
  reflection rules against the actual reflection file, not just confirm the
  check passes — a repeated "screenshot + pnpm check" verification loop can
  run green for many cycles while missing a plain-text doctrine violation the
  tooling was never built to catch.
- Wiring a real Lighthouse check (`lighthouse` + `chrome-launcher` npm
  packages, serving `dist/` with vite's own `preview()` API): `chrome-launcher`
  auto-detects a system Chrome on Linux by running `which` for
  `google-chrome-stable`/`google-chrome`/`chromium-browser`/`chromium`, which
  GitHub's `ubuntu-latest` runner has preinstalled — no extra CI setup needed.
  This sandbox has no system Chrome, only `agent-browser`'s downloaded copy at
  `~/.agent-browser/browsers/chrome-*/chrome`; pass that as `chromePath` (or
  via `CHROME_PATH` env, which `chrome-launcher` also reads) for a local run,
  leave it unset for CI. Confirmed in `comp4020-crit1-bada` week 1: the first
  real run of the sensor failed on real SEO gaps (missing meta description,
  and — subtler — vite preview's SPA-style fallback answering a `/robots.txt`
  request with the `index.html` body, which Lighthouse then tried and failed
  to parse as robots syntax line by line). That before/after failure was
  itself the sanity-check that the sensor isn't a rubber stamp, cheaper than
  building a separate deliberately-broken fixture.
- A live re-render that does `element.innerHTML = "<template string>"` on a
  container silently deletes any static children that container held before
  — including a `<title>`/`<desc>` an `aria-labelledby` elsewhere points at.
  jsdom-based spec tests didn't catch this (they mount a bare fixture, not the
  real `index.html`), only a real-browser axe-core audit against the actual
  page did (`svg-img-alt` violation, "aria-labelledby references elements
  that do not exist"). Fixed in `comp4020-ass1-bada` week 4 (`9a95b1a`) by
  re-emitting the title/desc inside the template string on every render, and
  added a jsdom regression test asserting they survive a render — but the
  bug itself was only findable by running axe against the live DOM, not by
  reading the diff. Worth checking any `innerHTML =` on a long-lived element
  for referenced children before trusting a static a11y annotation on it.
- A repo can be provisioned late enough that the normal week-long clock never
  applies — `comp4020-crit2-bada` opened with ~30 minutes of wall clock left
  before the crit itself, not 168 hours. What held up under that compression:
  picking a real target fast (a couple of `WebFetch` passes, not a deep
  crawl), building the smallest honest version of the brief rather than an
  ambitious one, running the check suite exactly once at the end rather than
  iteratively, and writing PROCESS.md/reflection content that names the one
  real judgement call made (here: refusing to fabricate opening hours two
  real sub-pages 404'd on) rather than padding out several. Confirmed in
  `comp4020-crit2-bada` week 3.
- This `agent-browser` build has no bandwidth/latency throttle (`network
  --help` only lists `route --abort`/`--body`, `har`, and request listing —
  no `emulate`/`throttle`/CDP network-conditions command). The working proxy
  for "what does a slow connection see" is `agent-browser network route
  "**/main.ts" --abort"` (swap the pattern for whatever script the page
  defers on) then reload: whatever renders with the script permanently
  blocked *is* what a slow connection sees for however long the real request
  takes. Found a real bug this way in `comp4020-ass1-bada` week 4 (`c009c90`):
  `<output>` elements and an interactive row/chart were blank/garbled
  ("a -chunk context") until JS ran — fixed by giving the static HTML
  defaults that match what the render function computes for the inputs' own
  default attribute values, so first paint is already correct. A citation
  check the same run showed the flip side of the same discipline: don't stop
  at the paper's abstract when checking a specific claim against it — one
  clause ("worse as more documents were added") wasn't abstract-supported but
  was true in the paper's body, findable only with a further search past the
  abstract text.
- A green test suite can still be asserting the wrong contract: a spec test
  in `comp4020-ass1-bada` was literally named "is symmetric around the
  middle of the context" and passed reliably, but a web search on the cited
  paper's actual figures (Liu et al. 2023) showed the real effect is
  asymmetric — primacy (start) recall edges out recency (end) recall, not a
  clean symmetric U. The test had encoded an unverified simplifying
  assumption from the model's first draft as if it were a real invariant.
  Fixed in `comp4020-ass1-bada` week 4 (`cdd57e9`) by changing the model to
  match the source and replacing the test with one asserting the verified
  asymmetry — a case where the correction was rewriting a test, not just
  editing the implementation to keep passing it. Worth treating any test
  whose name asserts a property of the *domain* (symmetric, monotonic,
  linear, etc.), rather than a property of the code's own behaviour, as a
  claim to verify against the real source before trusting it as a fixed
  contract.
- A page's own copy can describe an affordance that was never actually built
  — same failure mode as the domain-property test above, but in prose instead
  of a test name. `comp4020-ass1-bada`'s lede said "Drag it around" from the
  very first commit; the only control was ever a range slider, never real
  dragging, and it survived several later "interaction review" passes because
  each one read the markup rather than trying to drag the thing. Only caught
  by actually loading the live page in `agent-browser` and attempting the
  literal action the copy promised. Fixed week 4 (`0dd2315`) by wiring real
  pointer drag onto the row so the copy became true instead of editing the
  copy down to match the weaker mechanic — worth treating any second-person
  imperative in a page's own copy ("drag", "click", "type") as a claim to
  physically test, not just proofread.
- Self-review of your own prose is weaker than it looks once you've read the
  file with full context loaded --- you already know why each line is there,
  which makes it hard to see it as a first-time reader would. Spawning a
  fresh subagent with *only* the passage in question plus the grading bar
  text (no other page context, no history of prior edits) got a genuinely
  different read in `comp4020-ass1-bada` week 4: it caught that a lede opened
  on a definition before earning the reader's attention, and that the
  sentence's one surprising clause was grammatically subordinate rather than
  the main point --- the same failure mode a previous run had already fixed
  elsewhere on the same page, invisible to self-review because self-review
  keeps re-confirming what it already decided was fine. Don't skip
  fact-checking the subagent's proposed rewrite before adopting it, though:
  its rewrite claimed a mid-context fact "may as well not have been supplied
  at all," and a web search on the actual cited paper (Liu et al. 2023)
  showed this undersold the real finding (GPT-3.5-turbo scores *below* its
  no-context baseline with the fact mid-context) rather than oversold it ---
  lucky this time, but the check was still necessary before treating a
  fluent-sounding claim as verified. Confirmed in `comp4020-ass1-bada` week 4
  (`6c144dc`).
- jsdom has no layout engine, so `getBoundingClientRect()` on any element
  always returns zeros — a test for pointer-drag-to-nearest-element math
  needs to stub `getBoundingClientRect` on each candidate element by hand
  (return a fixed rect per index) rather than relying on real layout; test
  the actual coordinate math as a separate pure function so most of the logic
  is verifiable without any DOM at all. Also, plain jsdom (via the `JSDOM`
  import, not the `jsdom` vitest environment) has no global `PointerEvent`
  constructor — construct via `doc.defaultView.PointerEvent` (falling back to
  `MouseEvent`) and set `pointerId` with `Object.defineProperty` if the
  fallback doesn't carry one. Confirmed in `comp4020-ass1-bada` week 4
  (`0dd2315`).
- A subagent's proposed prose rewrite can read as strictly better while
  silently dropping a live-bound element it wasn't told mattered. A blind
  fresh-eyes reviewer in `comp4020-ass1-bada` week 4 proposed a figcaption
  rewrite that improved the prose but deleted the `<output>` element bound to
  a length slider, which would have quietly killed a working live-update
  mechanic — caught by grepping `main.ts` for the element's id
  (`length-value-2`) before accepting the text, not by reading the HTML diff
  alone, since the surrounding markup still looked plausible on its own.
  Adapted the rewrite to keep the binding rather than taking it verbatim.
  Worth checking any subagent-proposed markup change for `id`/`for`
  attributes referenced elsewhere before adopting it, same discipline as
  fact-checking a subagent's prose claim against its source (`deb8dd4`).
- The blind-fresh-eyes-subagent technique (give it only the artefact plus the
  grading bar, no conversation history) generalises past prose to interaction
  *logic*: pointed at `comp4020-ass1-bada`'s explainer with the actual spec
  bullets, it found that stretching a context length left the fact's raw
  array index untouched, so a fact pinned at "the end" of a short context
  silently drifted toward "the middle" of a longer one — the opposite of what
  the page's own copy promised ("stretch the context without moving the fact
  at all"). Confirmed empirically in a real browser before trusting the
  report (`agent-browser eval` toggling the sliders and reading the output
  text), then fixed by rescaling position proportionally on length change.
  Fixing it surfaced a second, general HTML gotcha worth keeping outside any
  one project: an `<input type="range">` clamps an assigned `.value` to its
  *current* `.max` at assignment time, so code that widens the range and
  moves the value in the same handler must set `.max` first — setting value
  first silently clamps it back to the old range with no error. Confirmed in
  `comp4020-ass1-bada` week 4 (`2b174bc`).
- A drag/click surface's coordinate *math* being correct doesn't mean the
  surface is correct — the pointer-drag row in `comp4020-ass1-bada` had fixed-
  width flex children with no `flex-grow`, so the visible bordered box was
  mostly empty at low item counts (89% dead space at the minimum setting) and
  any click there silently snapped to the last item instead of responding
  proportionally. `indexOfNearestCenter` was never wrong; the DOM just didn't
  fill the container it looked like it should. Only found by comparing
  `getBoundingClientRect()` of the last child against the container at more
  than one item count (`agent-browser eval`), not by reading the CSS or
  screenshotting only the default state — the ratio only looks obviously
  broken away from the default. Fixed with `flex: 1 1 0` on the children
  (`3fc1f1d`). General check: for any container a user clicks/drags across
  proportionally, measure filled-extent vs. container-extent at more than one
  configuration before trusting the interaction.
- A further variant of the blind-fresh-eyes-subagent technique: point it at a
  brief's own cited exemplar quote, not just the grading-bar text, when the
  brief names a specific standard for what "good" looks like. Assignment 1's
  brief calls Ciechanowski's *Mechanical Watch* the genre's ceiling because
  "every part is manipulable and the explanation *is* the interaction" — given
  only `comp4020-ass1-bada`'s page text plus that quote, a blind subagent
  found the lede pre-stated the entire finding the interactive section was
  supposed to teach, so the interaction was purely confirmatory, never
  load-bearing. Fixed with a copy-only edit (moved the explicit claim past the
  interactive section, left the lede as a hook), no interaction/scope change
  (`8f12b20`, `comp4020-ass1-bada` week 4). Worth trying on any future
  deliverable whose brief names a specific ceiling exemplar with a stated
  reason it's the ceiling — that reason is a checkable claim about your own
  page, not just flavour text.
- When a spec caps `PROCESS.md` at three or four moments and separately asks
  for a reflection breakthrough, a strong late-arriving finding doesn't have
  to displace one of the capped moments — it can carry its full weight in the
  reflection instead, if the existing moments are each a distinct failure
  mode and the new one would either duplicate one (two "copy" moments here)
  or leave no clearly-weakest one to cut. `comp4020-ass1-bada`'s four
  PROCESS.md moments (a11y bug, slow-connection defaults, domain-property
  test, copy-vs-build mismatch) stayed untouched at the assignment-1
  finishing pass; the lede-catch (`8f12b20`) became the reflection's
  breakthrough instead, since it's also the one finding driven by checking
  the brief's own language rather than a testing technique — a genuine fit
  for "response to the brief" as well as "process." Confirmed
  `comp4020-ass1-bada` week 4 (`8e7c202`). Worth revisiting explicitly at the
  finishing pass with the full candidate set in view, not deciding early or
  by default.
- For any deliverable whose own judging method is "try it cold, then talk"
  (an instrument crit's pod plays before anyone explains it — see the
  crit-4 source body), doing that same cold-open pass yourself before
  adding anything finds real, specific gaps that speculative feature
  brainstorming doesn't. `comp4020-crit4-bada` week 5 did this twice: run 2
  opened the page silently and found the only pre-interaction affordance
  was hint text, nothing visual moved (fixed with an idle glow, `de810ef`);
  run 3 did the same open-cold-and-play pass again and found pointer input
  had three expressive dimensions (pitch, brightness, speed-vibrato) while
  keyboard input had exactly one (pitch only, chords included) — a real
  asymmetry invisible from reading the code, only found by actually
  chording the home row and noticing every note landed at the same fixed
  brightness (fixed with a live arrow-key brightness sweep, `58dfda4`).
  Both fixes closed a genuine gap the brief's own bar names ("two players
  sound different," "playable with whatever is at hand") rather than
  adding a feature for its own sake — worth repeating this cold-open check
  at the start of every deepen run on this kind of deliverable, not just
  once.
- A third pass of that same cold-open check on `comp4020-crit4-bada` (run 4,
  week 5, `5d92c29`) found a different bug shape: a canvas redraw that only
  ever applies a translucent fade (for a fading-trail effect) rather than a
  hard clear, combined with an animation loop that permanently stops itself
  on a one-way state flag (`interacted = true`), means whatever the loop's
  last frame happened to be — here, an idle-glow blob mid-drift — freezes on
  screen forever once the loop stops, because nothing else was ever going to
  erase it. Confirmed with `ctx.getImageData` at the exact pixel (background
  should read `[11,11,20]`; it read `[41,50,76]`, the glow's tint, both
  before and stuck-around after a mouse-down/up) rather than eyeballing a
  screenshot alone. The general check: any canvas code that (a) redraws via
  a translucent overlay instead of a hard clear, and (b) has an animation
  loop that can permanently stop itself on a state transition, needs an
  explicit hard clear *at* that transition — the loop stopping is exactly
  the moment nothing will ever finish fading the last frame out.
- A fourth cold-open pass on `comp4020-crit4-bada` (run 5, week 6, `fc9eb47`)
  found a bug the previous three didn't, because it wasn't found by clicking
  and watching but by asking "what happens if I leave mid-note": any
  `window`-scoped `keydown`/`keyup` pair for held-note state is vulnerable to
  the browser never delivering the matching `keyup` when focus leaves the
  window while the key is still physically down (alt-tab is the common real
  case) — the note drones on, and if the handler also guards re-trigger with
  something like `heldNotes.has(e.code)`, the player can't even restart that
  note once focus returns, because the map still thinks it's held. No jsdom
  jump needed to find this: dispatch a real `keydown`, monkeypatch (via
  `agent-browser open --init-script`) whatever the "stop" primitive is (here
  `OscillatorNode.prototype.stop`) to count calls, dispatch a plain
  `window.dispatchEvent(new Event("blur"))` with no keyup, and check the stop
  counter didn't move. The fix is a `window` `blur` listener that force-stops
  and clears every held-key (and, defensively, held-pointer) voice — cheap,
  and it's the only way a player can ever silence a stuck note short of
  reloading. Worth checking any keyboard-driven interactive page (not just
  instruments — games, drag tools, anything with a "held" state keyed by
  `keydown`/`keyup` pairs) for a `blur` handler before assuming keyup alone
  is enough.
- An `og:image` link-preview card is a case where the doctrine's blanket
  "commit images as AVIF" rule has a real, checkable exception: AVIF support
  for social/chat link-preview thumbnails (Slack, X, LinkedIn, iMessage) is
  inconsistent, so an og:image card is safer shipped as PNG/JPEG even though
  it's a committed image well under the 2560px/5MB guidance. Applied in
  `comp4020-crit4-bada` week 6 (`9b4fe3a`) replacing a template placeholder
  card.png with a real one composed (ImageMagick `convert`, DejaVu-Sans-Bold
  for text) from an actual `agent-browser screenshot` of the instrument mid-
  play, rather than reaching for a generic asset — the same "use the real
  artefact, not a stand-in" instinct as the mid-context-fact tests elsewhere
  in this file. Worth checking any future `og:image`/link-preview asset
  against this exception before defaulting to AVIF.
- `agent/` in a deliverable repo really is harness-owned, and not just by
  convention — editing `agent/MEMORY.md`/`agent/now.md` directly (instead of
  the outer `memory/` files this repo's `CLAUDE.md` and the doctrine actually
  point at) gets silently reverted. A run in `comp4020-crit4-bada` week 6
  wrote a real finding straight into `agent/MEMORY.md`/`agent/now.md` in the
  repo (commit `1a8fb22`) without also updating the outer `memory/` files.
  The very next "memory: tick" commit (`3501a88`) overwrote both `agent/`
  files back to the *outer* memory's (unchanged, stale) content — the tick
  process syncs outer→repo, so any edit made only in the repo copy has a
  half-life of one tick. The lesson `1a8fb22` tried to record (a `now.md`
  hand-off can be stale even sitting at `HEAD`) was itself erased this way,
  and had to be reconstructed from `git show <commit> -- agent/MEMORY.md` on
  a commit that no longer matched the working tree. Always write to the
  outer `memory/now.md` and `memory/MEMORY.md` (`/home/ben/projects/comp4020
  /agents/bada/memory/` — one level up from any deliverable repo), never to
  a repo's own `agent/` copy, and diff the outer files against `agent/` at
  the start of a run if something in `agent/` looks newer than what was just
  read — that's the sync running backwards, not forwards.
- A lowpass filter's audible effect should be measured by spectral centroid
  (harmonic-amplitude-weighted mean frequency), not RMS — RMS is dominated by
  the fundamental (the loudest partial), so a filter that meaningfully
  reshapes the harmonics above it can leave RMS nearly unchanged even when
  the timbre change is real. This is a step beyond the earlier sine-vs-filter
  finding in this file (a *sine* has no harmonics to filter at all): here the
  oscillator already had real harmonic content (a triangle wave), yet an
  RMS-based check would have called the brightness control "basically fine"
  while a centroid measurement showed under 4% shift even at the best note —
  inaudible in practice. Also generalises the earlier fix's other half: don't
  size a filter's cutoff range as one fixed Hz band shared across a
  multi-octave scale — a low note's own harmonics already sit close together
  in Hz, so a fixed range barely reaches past them, while the same range
  barely touches a high note's much more widely (in Hz) spaced harmonics
  either, for the opposite reason. Fix is filter *keytracking*: cutoff =
  note frequency × ratio, so the same brightness fraction sweeps the same
  proportional harmonic content regardless of pitch — measured to bring
  every note in the scale to a consistent ~110% centroid shift, versus <4%
  with a fixed range. `BiquadFilterNode.getFrequencyResponse()` at each
  harmonic (weighted by the oscillator's own theoretical harmonic series —
  triangle: odd only, 1/n²; sawtooth: all, 1/n) computes this centroid
  without any real audio output, so it works in this headless sandbox same
  as the original filter-response check. Fixed in `comp4020-crit4-bada`
  week 6 (`981b2f9`), also switching triangle→sawtooth since a sawtooth's
  slower harmonic falloff gives the filter more to act on. Confirmed live in
  `agent-browser` too: traced the real `BiquadFilterNode.frequency` value at
  four corners of the pad (low/high pitch × dark/bright) and the ratio to
  the note's own fundamental stayed consistent (~1.5–14×) across all four,
  where the coordinates actually landed inside the canvas's own
  `getBoundingClientRect()` — a first pass at this got nonsense-looking
  identical readings back because the test coordinates (`y=100`) landed
  above the canvas, in the page's header, not on the pad at all; always
  check the canvas's real bounding rect before trusting synthetic
  coordinates as "on the pad."
- A spawned subagent with genuinely no source-code access (only the live
  rendered page via `agent-browser` and the brief's own spec bullets) playing
  an instrument cold is a stronger check than the agent's own cold-open pass,
  because the model that wrote the code can't help pattern-matching on what
  it already knows the hint/aria-label say. Given only "here's a URL, you've
  never seen this, play it," a blind subagent in `comp4020-crit4-bada` week 6
  tried Q/W/E first (no feedback at all — no dot, no hint change) and
  concluded keyboard didn't work, because the visible hint text said "press a
  key to play" without ever saying which key; the actual keys (A–L) were
  named only in the canvas's `aria-label`, invisible to a sighted player. Not
  a functional bug — mouse/touch worked immediately — but a real gap against
  "an uninstructed stranger can begin playing" for anyone who tries keyboard
  first. Fixed by putting the same key names already in the aria-label into
  the visible hint text too (`f2e2185`). General check: when a page's
  aria-label names a control's actual affordance (specific keys, specific
  gesture) that the visible copy only gestures at vaguely, that's a
  discoverability gap for sighted users, not just a missed a11y nicety in
  reverse — worth surfacing the same specifics in both places.
- A fifth cold-open pass on `comp4020-crit4-bada` (run 6, week 6, `be24405`)
  found a bug distinct from the earlier "one-way stopping transition leaves
  the last frame stuck" bug in this file: here there was no continuous
  animation loop driving the trail/glow at all while playing — every
  fade+redraw happened synchronously inside the pointermove/keydown handlers
  themselves, so a released note's dot only ever faded on the *next*
  unrelated input event, anywhere on the pad. A player who stopped got a
  frozen, stale-looking pad instead of watching the sound decay, confirmed
  with `getImageData` on the exact drawn pixel: bit-identical across a
  multi-second idle gap, then dimming only the instant some other key was
  pressed elsewhere. Any canvas effect meant to read as "fading/decaying
  over time" (trails, glows, particle effects) needs its own
  `requestAnimationFrame` loop independent of input event cadence — a
  per-event fade is really "fades one step per *other* action," which looks
  identical to "never fades" whenever the player goes idle. The general
  cold-open lesson holds again too: found by leaving a note playing and
  doing nothing, not by reading the code.
- A sixth cold-open pass on `comp4020-crit4-bada` (run 12, week 7) — same
  blind-subagent, source-inaccessible protocol as the five before it,
  covering mouse/keyboard/touch, chording, held-note decay, blur-mid-note,
  three viewports, and console-mash — came back clean for the first time.
  This is the expected end-state of repeated adversarial testing, not a sign
  the technique stopped working: five real bugs across five prior passes,
  each fixed, then a sixth pass that finds nothing is what "the fixes are
  holding up" looks like. Don't force a seventh identical pass on a future
  run just to keep the streak going if time is better spent on finishing-run
  prep (rereading `PROCESS.md`/`reflections/README.md`, drafting reflection
  language) — a clean cold-open result is legitimate evidence, not grounds
  for suspicion that the test wasn't thorough enough.
- After a clean cold-open pass, the productive next angle was a code-level
  edge case rather than another play session: `comp4020-crit4-bada`'s
  pointerdown handler did `pointerVoices.set(e.pointerId, startVoice(...))`
  unconditionally, with no check for an existing entry. A real mouse's
  pointerId is always `1` for the whole device, and pressing a *second*
  mouse button while the first is still held fires another `pointerdown` for
  that same pointerId with no `pointerup` in between (confirmed by
  dispatching two synthetic `pointerdown`s then one `pointerup` on
  `pointerId: 1`) — so the map overwrite orphaned the first voice's
  oscillator and LFO, which then droned forever with no way to stop them
  (the map only ever pointed at the newest voice). Same
  monkeypatched-`OscillatorNode`-counter technique as the blur-mid-note fix
  elsewhere in this file, applied to a different trigger: 4 `.start()` calls
  against only 2 `.stop()` calls before the fix, 4 against 4 after. Fixed by
  stopping any existing voice for that pointerId before starting the new one
  (`6e3e321`, run 13, week 7). General check: any `Map.set(key, ...)` keyed
  by an id a real device can reuse across overlapping "sessions" (a pointer
  id, a touch id) needs to check for and clean up an existing entry first,
  the same discipline `e.repeat || keyVoices.has(e.code)` already applied on
  the keyboard side of this same file — the pointer side was the one path
  that had never been checked for the analogous case.
- The template's `pnpm check:evidence` (`scripts/check-evidence.ts`) checks
  a narrower thing than "the citation is correct": it extracts each cited
  commit hash from `PROCESS.md` by regex on the bracket text alone —
  `[`<sha>`](...)` — and verifies the SHA resolves locally with
  `git cat-file -e`. It never reads or validates the URL inside the
  parentheses at all, so a citation whose link points at the wrong org, the
  wrong repo, or a typo'd path still prints a clean
  `✓ PROCESS.md: N cited commit(s) all resolve`. Confirmed by reading the
  script directly in `comp4020-crit4-bada` week 7 while writing the
  finishing-run `PROCESS.md`. Same shape as the reflection-heading-vs-check
  gap found in `comp4020-crit1-bada` week 1 (elsewhere in this file): the
  automated sensor verifies a narrower, mechanical proxy for the
  requirement, not the requirement itself. On any deliverable using this
  template, hand-check `PROCESS.md`'s citation URLs against `git remote -v`'s
  actual org/repo before shipping — a green `check:evidence` is not evidence
  the links themselves resolve to the right place on GitHub.
- For a reflex/timing game whose only mechanic is a single input (a jump, a
  dodge), "is there a real skill ceiling" is checkable from this CLI without
  a human pod: script `agent-browser press <key>` on a fixed short interval
  (faster than a human could deliberately time) for many seconds and read
  back a game-state hook (here, an `aria-live` status element's text) rather
  than eyeballing a screenshot. If constant mashing never loses, the
  "difficulty ramp" is decorative and the game can't actually be lost by a
  player paying attention, only by one who stops playing — a real design
  flaw, not just a hard-to-verify claim. Confirmed doing this on
  `comp4020-crit5-bada`'s runner (build run, week 6): 18s of
  press-every-150ms mashing still produced multiple deaths and restarts
  (best score crept up rather than never arriving), verifying the
  speed/spawn ramp genuinely defeats pure-spam play rather than assuming it
  from reading the ramp constants. Generalises the brief's own framing for
  this deliverable ("a collision ends the round can be tested, but only
  playing can tell you whether it feels fair") — scripted rapid input is a
  way to *play* it adversarially from a CLI, a middle ground between a unit
  test and a human pod.
- Following the earlier corrupted-cold-open lesson in this file exactly
  (finish any main-thread `agent-browser` use and close the browser *before*
  launching a background blind-playtest subagent, don't touch the browser
  again until it reports back) produced a genuinely reliable report on a
  second attempt, `comp4020-crit5-bada` week 6 (`87c077d`). The isolated
  subagent's claims were checkable and mostly true this time (fair-feeling
  collisions, clean restarts, working mobile viewport) except one flagged-as-
  unconfirmed anomaly it explicitly declined to assert as a real bug — a
  sign of a well-calibrated report, not a rubber stamp. Its one confirmed,
  reproducible finding: the `#status` `aria-live` element is written only on
  death (`endRun()`) and nothing ever clears it going the other way, so a
  screen-reader user restarting after a loss keeps hearing the previous run's
  final score long after the visible canvas score has reset to 0 and climbed
  past it. Reproduced by hand (`agent-browser eval` reading
  `#status.textContent` immediately after a death, then again immediately
  after the restart press, across two independent death/restart cycles) and
  fixed with one line clearing `status.textContent` in `resetToIdle()`.
  General check, generalising the `distance`-not-reset bug fixed the previous
  run: any one-way state write that only fires on entering a state (a status
  announcement, a "you died" flag, a persisted high score) needs an explicit
  clear or reset on the *reverse* transition, checked by driving both
  directions of the transition and reading the same hook each time, not just
  the direction that's easy to trigger once.
- A "no instructions, teaches itself" brief has a checkable test for whether
  a proposed *new* mechanic is safe to add, not just a vibe call: can a
  stranger who dies against it plausibly guess the input from the death
  alone, the same way they guessed the first mechanic? On
  `comp4020-crit5-bada` (week 6), adding a Chrome-Dino-style duck mechanic
  (an overhead obstacle only passable by crouching, made uncounterable by
  jumping by keeping the player's rect overlapping it through the whole jump
  arc, not just at apex) was mechanically buildable, but there's no way to
  design a death against it that teaches "hold ArrowDown" the way the
  existing single mechanic teaches itself — every input that currently
  matters (Space/ArrowUp/Enter/click/tap) is the *same* one a stranger tries
  within seconds of landing on the page. Decided against building it for
  that reason, not from generic scope-creep caution. General check for any
  future "should this game have a second mechanic" call on a no-tutorial
  brief: a second mechanic only clears the bar if a death against it can be
  attributed, by the player, to the *specific new input* needed — not just
  "something else must have been possible."
- "Only playing can tell you whether the collision feels fair" doesn't
  require a live human/browser pod every time — a faithful Node
  reimplementation of the exact collision function plus the exact physics
  constants, driven against the worst-case parameters the real code can
  generate, is a legitimate way to answer a specific fairness question the
  same technique already used for the `BiquadFilterNode.getFrequencyResponse`
  brightness-filter check elsewhere in this file, applied to jump timing
  instead of audio. On `comp4020-crit5-bada` (week 6), simulating a
  back-to-back obstacle pair at the coded minimum gap and max height found
  that a naive "clear both with one jump" strategy has a genuinely
  frame-perfect window (~5.5ms, under one real frame) right at its
  speed-threshold of first becoming possible — which would be a real
  fairness bug if it were the only path — but the "land, then immediately
  rejump" fallback stays comfortable (246–550ms) at every speed the game
  reaches, so the scenario is fair in practice. Worth reaching for this
  method before scripting live wall-clock-dependent browser input timing
  (fiddly, and vulnerable to the separate main-thread/subagent
  `agent-browser` cross-talk issue above) whenever the fairness question is
  really about deterministic physics/collision math and the source
  constants are known — reserve live pod/subagent testing for questions a
  simulation genuinely can't answer (does it *feel* right, is the input
  discoverable, does a real device deliver events the sim assumes).
- After two consecutive clean cold-open passes on `comp4020-crit5-bada` (see
  the run-12-equivalent lesson above), the productive next angle wasn't an
  eighth identical playtest but a different question: does the game's own
  global input handler interfere with the *rest of the page*, not just the
  game surface? A `window`-scoped `keydown` listener that intercepts
  Space/ArrowUp/Enter unconditionally (so mouse/keyboard work anywhere
  without first clicking the canvas) also fires when a completely unrelated
  focusable element — here, the page's own `<a href="./">Home</a>` nav
  link — has focus, and `preventDefault()`s before the browser's native
  Enter-activates-a-focused-link behaviour can run. Confirmed with
  `agent-browser`: tab to the link, set a `window.__marker`, press Enter —
  the marker survived (no real navigation happened) and `#status` showed a
  just-finished run, proving the keypress was swallowed by the game instead
  of activating the link. Fixed by gating the handler on
  `document.activeElement` being the canvas or `document.body` only
  (`37d5530`), re-verified the same way (marker now correctly cleared by a
  real navigation, and confirmed body/canvas focus still trigger the game
  as before). General check: any page-wide keydown listener installed for
  "works without clicking anything first" convenience needs an explicit
  check that it isn't shadowing the native keyboard semantics of *other*
  focusable elements already on the page (nav links, buttons) — a cold-open
  playtest of the game itself won't surface this, since it never tabs
  anywhere except into the game.
- A resize handler that recomputes one piece of live layout state (here,
  `groundY` from `height`) is an easy place to miss a *different* piece of
  state that's stored absolute rather than derived — `comp4020-crit5-bada`'s
  `resize()` (week 6/7) recomputed the player's y and, via a live
  width-fraction in `playerRect()`, the player's x every frame, but
  in-flight `Obstacle.x` values were set once at spawn and never touched by
  `resize()` at all. A width change moved the player instantly while every
  obstacle stayed exactly where it was, turning a mid-run browser resize
  into a free pass through an obstacle that would otherwise have hit, or an
  unearned death from one that wouldn't have. Fixed by capturing `oldWidth`
  before reassigning `width` and multiplying every obstacle's `x` by
  `width / oldWidth` when not idle (`096fb2a`). General check: for any
  layout-driven object whose position is a mix of "recomputed live from a
  dimension" (the player, here) and "set once and left absolute" (the
  obstacles), a resize handler needs to explicitly migrate the absolute
  ones by the same ratio, not just recompute the live ones — the two classes
  don't automatically stay in relative sync just because both use the same
  underlying `width`/`height`.
- That same fix had a real false start worth the general lesson on its own:
  a first resize test showed the player's traced x never changing across a
  viewport change, which looked like proof the native `window` `resize`
  event doesn't fire for `agent-browser set viewport`/CDP-driven viewport
  overrides — plausible enough that a `ResizeObserver`-based replacement got
  written and nearly shipped, comment and all, asserting this as
  "confirmed." The real cause was mundane and had nothing to do with event
  firing: `canvas { width: min(90vw, 720px) }` caps the canvas's actual
  rendered width once viewport width crosses ~800px, and both test
  viewports (the default, and 1400px) sat above that threshold, so the
  canvas's `getBoundingClientRect().width` was 720px in both cases — no
  resize of the *canvas* ever happened, native event or not. Caught by
  redesigning the test with two viewports that both stay under the cap
  (500px and 900px, giving genuinely different canvas widths of 450px and
  630/720px), which showed the native listener firing and updating the
  player's x correctly, disproving the theory before the wrong fix shipped;
  reverted the `ResizeObserver` change and kept only the real fix. General
  check: before trusting a "no effect observed" result from a resize/layout
  test, verify the thing being measured (here, the canvas's own rendered
  box) actually changed at all between the two conditions — a CSS
  `min()`/`max()`/`clamp()` cap on the element under test can silently make
  two different viewport values produce one identical rendered size, and a
  clean null result from that setup proves nothing about the code being
  tested.
- A bug fixed and verified only by hand (a live `agent-browser` trace, a
  screenshot, a manual arithmetic check) is still an untested regression
  risk once the run ends — the next person to touch that code has no
  automated signal if they break it again. Where the fix's core logic is a
  pure calculation buried inside a DOM-coupled function (here, the ratio
  math inside `resize()`), extracting it into a small named pure function
  in the project's already-DOM-free logic module (`game-logic.ts`, next to
  `rectsOverlap`) and adding a couple of unit tests costs very little and
  converts a one-off manual verification into a permanent sensor. Applied
  in `comp4020-crit5-bada` week 7 (`e5a6620`) to the resize-desync fix
  (`096fb2a`, itself only traced by hand the run before): pulled
  `rescaleObstacleX(x, oldWidth, newWidth)` out of `resize()`, three tests
  added, 21→24 in the suite. Worth doing this as a default follow-up
  whenever a deepen run's cold-open-playtest thread goes clean and a prior
  run's fix is sitting on manual verification alone — better use of
  remaining deepen time than forcing a repeat playtest past the
  established two-clean-passes-and-stop bar. Not every fix extracts this
  cleanly, though: a fix that's really about DOM state (an aria-live
  string, a visual affordance) doesn't have a pure-function core to pull
  out, and forcing one would just be testing implementation rather than
  the contract — that class is still better checked live.
- Following the earlier "a second mechanic only clears the no-tutorial bar
  if a death against it is attributable to a specific new input" rule in
  this file (the duck-mechanic rejection), the fix isn't always "don't add
  a second mechanic" — reusing the *same* input the first mechanic already
  uses sidesteps the whole problem. `comp4020-crit5-bada` week 7 (`1e497aa`)
  added a double jump gated by a pure `tryJump(jumpsUsed, maxJumps)`: a
  death against a tall (only-clearable-with-two-jumps) obstacle is still
  attributable to "I didn't jump enough," the same feedback shape as the
  base mechanic, because there's no new key to miss. Verified fair in two
  stages before ever playtesting: an out-of-browser Node simulation of the
  exact gravity/velocity constants found a 500ms+ non-frame-perfect window
  between the two presses, then a live trace of the actual bundled build
  (monkeypatching `CanvasRenderingContext2D.prototype.translate` via
  `--init-script`, since `draw()` calls it once per frame with the
  player's exact center) confirmed the shipped code produces the identical
  apex heights the simulation predicted (125px single, 229px double) —
  closing the gap between "the math says it's fair" and "the shipped code
  behaves that way," same discipline as the `getFrequencyResponse`
  brightness-filter and back-to-back-obstacle checks elsewhere in this
  file. The isolated blind-playtest that followed surfaced a genuine, non-
  obvious nuance worth expecting on *any* secondary mechanic added to a
  no-tutorial game: the subagent's initial strategy was one deliberate,
  well-timed press per obstacle, which reliably died against every tall
  obstacle and did not lead it to try a second press on its own — it only
  found the double jump by mashing the button out of frustration after
  repeated deaths. This is still a genuine pass, not a discoverability bug:
  a 500ms+ window makes mashing a robust, near-inevitable discovery path,
  and "you get it by dying and experimenting, not by nailing it on the
  first guess" is Bushnell's "easy to learn, difficult to master," not a
  defect — resist the urge to patch this with a visual hint, which would
  undercut the same no-tutorial rule the mechanic was designed to respect
  in the first place. Worth checking any future secondary-mechanic
  playtest for *how* it was discovered (deliberate first guess vs.
  experimentation-after-failure), not just *whether* it was discovered —
  the two have different implications for whether a hint is warranted.
- Not every apparent fairness risk in a difficulty-ramping game is a bug —
  simulate before assuming a floor/ceiling fix is needed. On
  `comp4020-crit5-bada` (week 6/7) the question was whether a tall
  obstacle's speed-scaled arrival time could ever outrun even a
  frame-perfect double jump, given an uncapped `SPEED_RAMP` that grows
  every frame with no maximum. A Node simulation of the exact jump physics
  plus the exact spawn-to-player travel-time formula showed reaction time
  does shrink below what a frame-perfect double jump needs — but only
  after ~114s of continuous survival (score in the low thousands), and
  concluded this is intentional, unbounded escalating difficulty, the same
  shape as Chrome's Dino game: the ceiling is *supposed* to eventually
  outrun any player, that's Bushnell's-law "difficult to master," not a
  fairness defect, and it doesn't touch a "stranger finishes inside five
  minutes" bar since that bar is about losing fast on an early attempt,
  not surviving five continuous minutes. No code change made — a genuine
  checked-and-clean outcome, distinguishable from a rubber stamp because
  the same simulation could instead have found the impossibility point
  inside the first 5–10 seconds, which would have been a real bug. General
  check for any game whose difficulty scales with elapsed survival time
  and has no explicit cap: before treating "does this mechanic ever become
  unfair at high difficulty" as an open question needing a code fix,
  simulate where the unfairness threshold actually falls and compare it
  against what the brief's own bar requires (finishing fast vs. surviving
  long) — an ever-increasing ceiling that a player will eventually lose to
  is the genre working as intended, not a bug to cap away.
- A weak colour distinction between two foreground game elements isn't
  automatically a bug if a second, non-colour cue dominates — check which
  cue actually carries the meaning before assuming CVD accessibility needs
  a fix. `comp4020-crit5-bada` (week 6/7) draws tall vs. short obstacles in
  `#2f5d8a` (blue) vs `#3a3a3a` (dark grey); computing WCAG contrast by hand
  showed only 1.65:1 between the two in normal vision, dropping to
  ~1.18–1.28:1 under a simulated deuteranopia/protanopia matrix (Machado et
  al. 2009) — genuinely too weak to rely on as a colour cue for anyone.
  But the two obstacle *heights* differ by 3–6× (145–165px tall vs. 26–54px
  short) on the same canvas, and forcing a tall obstacle to appear (an
  `--init-script` setting `Math.random = () => 0`, uncommitted, dev-server
  only) then screenshotting at both marking viewports (1920×1080, 390×844)
  confirmed the size difference reads as obviously different at a glance at
  both — colour was never the load-bearing cue, so its weak contrast never
  mattered. No code change made — a real checked-and-clean result, since
  the same contrast computation could instead have shown the two colours
  were also similar in *lightness* to each other and to the background
  (which would have been a real bug regardless of the other cue). General
  technique: WCAG contrast between two *foreground* colours (not just each
  against the background) plus a CVD simulation matrix answers "does this
  colour cue survive colour blindness" without ever opening a browser;
  `Math.random = () => 0` (or any other fixed value) via `--init-script` is
  a cheap way to force a specific rare game state (a tall spawn, a jackpot,
  an edge-case branch) into being on-screen for a screenshot, when the
  state depends on `Math.random()` internally and there's no exposed debug
  hook to trigger it directly.
- A background `Agent` task's completion notification with `status:
  completed` but no `<result>` block is not a finished report — it means
  the subagent stopped mid-task (in `comp4020-crit5-bada` week 6/7, a
  blind-playtest subagent opened the page, took two screenshots, and
  stopped after only 18.5s/5 tool calls, never pressing a key or clicking
  anything). Don't reach for `TaskOutput` to dig the answer out of the raw
  JSONL transcript in this situation — that transcript is meant to stay out
  of context (per the tool's own warning) and reading it via `TaskOutput`
  still dumps large raw JSON into context with no clean final-text field to
  extract. The right move is `SendMessage` to the agent's id/name telling
  it plainly what it skipped and to keep going — the resumed run's
  eventual completion notification *did* carry a proper `<result>` block
  with the actual report. General check: treat a `<result>`-less background
  completion as "stopped early," not "done," and resume via `SendMessage`
  rather than raw-transcript archaeology via `TaskOutput`.
- After a run of resize checks that only ever varied *width* (the
  `rescaleObstacleX` fix and its lessons above), the productive next axis
  on `comp4020-crit5-bada` (week 6/7, `4c95a1b`) was the one nobody had
  varied yet: window *height*. The canvas CSS was `height: min(60vh,
  480px)`; at both marking viewports (1920×1080, 390×844) that resolves to
  the same 480px canvas, so testing only those two — which the brief's own
  "play at both marking viewports" line invites — could never have found
  that a modest, non-maximised browser window (800×500, a plausible real
  window size, not an exotic device) shrinks the canvas to 300px and clips
  15–50px of the player off the top of the visible area during a
  double-jump apex, traced with the same monkeypatched-`translate`
  `--init-script` technique used elsewhere in this file. Collision math was
  unaffected (physics runs in canvas-coordinate space regardless of what's
  visibly drawn) — this was a "can the player see themselves" bug, not a
  fairness one. Fixed with a CSS height floor (`clamp(400px, 60vh, 480px)`)
  rather than touching any jump physics constant, specifically to avoid
  disturbing the extensively simulation-verified fairness numbers already
  established for those constants elsewhere in this file — re-traced at
  five window heights post-fix (all positive clearance) and reconfirmed
  both marking viewports unchanged at 480px. General check: when a fixed
  set of marking viewports all happen to hit the same clamped/capped value
  for some CSS dimension, that's a sign the *other* values that dimension
  can take (a resized window between the caps) are untested territory, not
  a reason to assume they're covered by proxy — and a state-bleed gotcha
  hit while measuring this, consistent with other findings in this file:
  reading a traced global via `agent-browser eval` without reloading the
  page between measurements can carry over game phase (idle/running/over)
  from a previous measurement's interactions, producing a plausible-looking
  but wrong number (a single-jump apex read back when a double-jump was
  intended) — always fresh-load the page immediately before each timed
  measurement in a sequence, not just once at the start of the batch.
- After the width/height resize axes were both closed, the next productive
  angle on `comp4020-crit5-bada` (week 7, `04c362d`) wasn't another
  playtest but a code-level question: which browser API calls in this file
  could throw, and does anything catch it? `main.ts` touched `localStorage`
  unguarded in two places (a module-top-level read building the initial
  `best` value, and a write inside `endRun()`), and either throwing is a
  real, non-exotic failure mode (Safari private browsing historically threw
  on `setItem`; enterprise/privacy policies and some embedding contexts can
  block `Storage` access entirely, including reads). Confirmed both with
  `agent-browser --init-script`: `Storage.prototype.setItem = () => { throw
  ... }` left the render loop permanently frozen after the next death (no
  `requestAnimationFrame(loop)` reschedule since `loop()` itself threw, no
  restart possible short of reloading) — verified by wrapping
  `requestAnimationFrame` to count frames and watching the count go static
  across repeated checks; `Object.defineProperty(window, "localStorage", {
  get() { throw ... } })` killed the *entire* module before its first
  `resize()`/`requestAnimationFrame(loop)` call ever ran — verified via
  `canvas.getAttribute("width")` reading `null` and a captured `window`
  `error` event, a strictly worse outcome (dead on arrival, not just
  dead-after-first-death). Fixed by wrapping both accesses in try/catch,
  graceful-degrading to "best just doesn't persist this session" rather
  than "the whole game is unplayable." General technique: for any
  browser-storage read/write not already guarded, this same
  monkeypatch-to-throw-via-`--init-script` pattern (already used elsewhere
  in this file for `AudioParam`/oscillator tracing) verifies whether a
  storage failure is contained or takes the whole page down — worth
  running once per deliverable that touches `localStorage`/`sessionStorage`
  directly, since the failure is invisible in normal testing (storage works
  fine in a default browser profile) and only shows up in a browsing mode
  nobody defaults to.
- A canvas draw call with no `fillStyle`/`strokeStyle` set immediately
  before it inherits whatever the *previous* draw call left the context
  in — normal `CanvasRenderingContext2D` semantics, not a bug in the API,
  but an easy trap for any conditional/rare-branch draw that isn't inside
  the same loop that sets colour per-iteration. On `comp4020-crit5-bada`
  (run 18, week 6, `bd68e48`) the idle-screen's own affordance hint — a
  small preview obstacle meant to signal "something's coming, get ready to
  jump" before the player does anything, the literal mechanism for this
  brief's one hard requirement ("the opening screen itself has to make the
  first move obvious") — had been rendering completely invisible for the
  entire life of the repo. `draw()` only sets `ctx.fillStyle` to the
  obstacle colour inside `for (const o of obstacles) { ctx.fillStyle =
  ...; ctx.fillRect(...) }`; on the idle screen `obstacles` is always `[]`,
  so that loop never runs, and the idle-preview `fillRect` right after it
  silently inherited the background fill colour set at the top of the same
  function — drawing the "obstacle" in the exact colour of the background.
  Seventeen prior runs' cold-open passes, screenshots, and even a
  deliberate a11y/affordance review all missed it, because the *composed*
  idle screen still looked fine (a real, correctly-visible pulsing glow
  around the player sat right next to the invisible obstacle, so nothing
  about the screenshot looked broken). Found only by going one level below
  "does the screenshot look right" to "what does each individual draw call
  actually draw": monkeypatching `CanvasRenderingContext2D.prototype.
  fillRect` via `agent-browser --init-script` to log `this.fillStyle` on
  every call showed the idle-preview call logging the background colour,
  and a direct `getImageData` read at its exact drawn coordinates came
  back flat background with no obstacle-shaped region — Fixed with one
  explicit `ctx.fillStyle = ...` line right before the previously-bare
  call. General check: for any canvas scene with more than one visible
  element, don't stop at "the screenshot looks plausible" — trace or
  sample the *specific* element you actually care about, especially any
  element whose draw call sits outside the loop/branch that normally sets
  colour for its category, since a scene can look entirely fine while one
  specific element is drawing in a colour that makes it disappear.
- An unescaped colon inside an unquoted YAML block-sequence string breaks
  `astro check`'s frontmatter parsing with a cryptic "can not read an
  implicit mapping pair; a colon is missed" pointing at the exact line/col —
  the colon gets read as a new mapping key starting mid-string. Found in
  `comp4020-ass2-bada` editing a `spec:` bullet to read "...one note per
  critique domain: visual art, code, ..."; fixed by swapping the colon for
  an em-dash (`---`), which also matches this template's house prose style
  better than a colon would have anyway. Worth remembering as the specific
  error signature to recognise, not just "check your YAML," since the
  message doesn't mention frontmatter or Markdown at all.
- A uniqueness/coherence test can be green while structurally unable to ever
  fail, if the values it checks are unique by construction rather than by the
  invariant it's meant to enforce. `comp4020-ass2-bada`'s
  `course-coherence.test.ts` asserted "no two sessions share a `domain:`
  frontmatter value" across all twelve sessions, but half of those twelve
  values were just the session's own title (`revision`, `portfolio
  check-in`, `receiving`...) restated as a domain — those can never collide
  with anything by definition, so the test was really only checking the six
  *real* critique-domain sessions, silently, while its assertion read as
  covering all twelve. A blind fresh-eyes subagent given the site's content
  plus the brief's own coherence bar caught this (among 7 other genuine
  findings out of 8 total — the other was investigated and found to be a
  false positive, per the standing fact-check-every-subagent-finding
  practice elsewhere in this file). Fixed by removing the frontmatter key
  entirely from the six non-domain weeks and asserting the *count* (`toBe(6)`)
  alongside the uniqueness check, so the test now fails if a real domain
  loses its key or a decorative one gains it. General check for any
  "no duplicates" test: ask whether every value under test is drawn from the
  same meaningful category, or whether some of them are unique for a reason
  that has nothing to do with the property being enforced.
- Auditing a `related:` content graph for "does this structure make sense"
  is more than checking edges resolve (that's a mechanical link check) — it
  means cross-referencing each node's own prose against its edges. On
  `comp4020-ass2-bada`, two crit sessions' own body text explicitly named a
  concept from a specific other week ("the same method [as week 3]," "care,"
  a term a different week's lecture defines) with no `related:` edge
  encoding that dependency, while sibling sessions making the identical kind
  of claim (a domain crit citing the lecture whose theory it applies) did
  have one. Found by dumping `dist/api/index.json`'s nodes and diffing which
  ones had zero `related` entries against which of *those* nodes' bodies
  contained a callback phrase to another week, not by eyeballing the graph
  shape alone (24 nodes/24 edges looked plausible without this). Note the
  field lives at the node's top level (`node.related`), not nested under
  `node.meta` alongside the other frontmatter — worth checking a sample
  node's actual JSON shape before writing a graph-traversal script against
  assumed nesting.
- A session's `spec:` frontmatter bullets can contradict its own `Bring`/`The
  crit` prose even when each half reads fine in isolation --- worth a pass
  that reads spec bullets *against* the body, not just against the brief.
  `comp4020-ass2-bada` week 1's spec asked students to name "the worst note
  you were ever given," but the Bring section explicitly instructs the
  opposite framing ("Not the meanest one and the nicest one --- the one that
  worked and the one that didn't"), sorting on efficacy, not severity ---
  present unedited since the file's first commit (`c392993`). Fixed by
  rewording the spec bullet to the worked/didn't-work axis the room actually
  uses. Same run also caught a subtler version one level up: week 12's
  "Leaves with" said the Final Project was "submitted" at the crit itself,
  even though the assessment's own `due:` frontmatter is a week later — the
  same "due the following Monday" pattern week 6 already states explicitly
  for Assignment 1, just unstated (and so silently contradicted) in week 12's
  copy. Caught by running actual day-of-week arithmetic (Python
  `datetime.date.fromisoformat(...).strftime('%A')`) over every session date
  and assessment `due:` date, not by eyeballing the dates as plausible ---
  confirmed the due date itself was correct (a genuine "following Monday"),
  narrowing the bug to the prose's tense/claim rather than the data. General
  technique for any dated, multi-page content site: (1) diff every `spec:`
  bullet against its own page's body for a claim the body explicitly rules
  out or never earns, and (2) compute real day-of-week arithmetic on every
  cited relative-date claim ("due the following Monday," "due same day")
  instead of trusting the frontmatter dates are self-consistent by
  inspection.
- An assessment page using `marking.mode: weighted` auto-renders a "How it is
  marked" table from the criteria/weight pairs in its own frontmatter
  (`MarkingModel.astro`, part of the starter template) --- so hand-written
  body prose explaining the same criteria must not restate the weight
  percentages, only add qualitative meaning, or a marker hits the identical
  numbers twice in the same scroll. `comp4020-ass2-bada`'s
  `assignment-1.md` had a "## How it's marked" section spelling out
  "Specificity (40%)" etc. right above the auto-rendered table doing the
  same thing; fixed by retitling to "## What the criteria mean" and dropping
  every inline percentage, keeping only the qualitative description
  (`884aaff`). Confirmed via `git log --follow` that `MarkingModel.astro`
  itself is original starter scaffolding, not something a past run wrote ---
  worth checking provenance before assuming a duplicate-looking section was
  authored deliberately. General check for this template: any assessment
  with `mode: weighted` should have its body prose read as a *companion* to
  the auto-table, not a paraphrase of it. The `mode: holistic` branch of the
  same component has the identical failure mode in a sharper form: it
  renders `marking.description` verbatim under its own auto "How it is
  marked" heading, so a hand-written body section that *also* states the
  marking basis isn't restating numbers, it's printing the exact same
  string twice. `peer-review-exchange.md`'s "## How it's marked" section
  was `marking.description` copied word for word into the body --- found
  only by a real-browser screenshot at 1920x1080 (the two headings, "How
  it's marked" and "How it is marked", read as plausible neighbours in the
  markdown source; only the rendered page showed the paragraph twice).
  Unlike the weighted case, holistic mode's manual section has no distinct
  qualitative content to preserve once the frontmatter description already
  says it all, so the fix was deletion, not a reword (`0512616`,
  `comp4020-ass2-bada` week 1). Check both `mode`s, not just `weighted`,
  when auditing an assessment for this pattern.
- Leftover developer/scaffold instruction text can leak into a shipped page
  through a custom `.astro`/`.mdx` page component, not just through markdown
  content --- a class of bug the doctrine's content rules don't mention
  because they're written for `src/content/*.md`. `comp4020-ass2-bada`'s
  `src/pages/sessions/index.astro` rendered a `<p>` explaining how to set
  `sessionLabels` in `src/site-config.ts` --- a note for whoever builds the
  site, left in after that customization was actually done, sitting as the
  first thing a visitor read below the intro on the Crits index page.
  Fixed by deleting it (`eca4852`); the explanation already lived as a code
  comment in `site-config.ts` too, so nothing was lost. A later run's blind
  cold-read subagent found the identical pattern on two more index pages ---
  `src/pages/assessments/index.mdx` ("Weights should sum to 100.") and
  `src/pages/lectures/index.mdx` (a paragraph explaining what `related:`
  does) --- both present unedited since the initial commit
  (`git log --follow`). This *disproves* this entry's own earlier claim that
  "lectures/assessments/people are theme-generated and don't need the audit"
  --- they're hand-authored `.mdx` files with `import ...Grid` calls, not
  template output, and the bug generalises across the whole set. Fixed by
  the same deletion (`8bff82e`). Corrected general check: `find src/pages
  -iname "index.*"` to enumerate *every* custom page (`.astro` and `.mdx`
  both, not just one extension), and read each one live once per
  deliverable --- don't assume any of them are template-generated just
  because they look structurally similar to a fixed one (here, `people` and
  `sessions` turned out clean, `assessments` and `lectures` didn't; the only
  way to tell them apart was reading each of the five actual files).
- This course-site starter (`astro-theme-university`, used across
  `comp4020-ass2-bada` and other course-site deliverables) derives its
  `astro.config` `base` from the git origin at build time
  (`scripts/pages-base.ts` → `resolveDeployment`), so a locally built site
  serves every page under `/<repo-name>/`, not `/`. `pnpm preview` on
  `comp4020-ass2-bada` answers a plain `curl localhost:PORT/` with a real
  404 even though the build is completely fine --- the actual home page is
  at `localhost:PORT/comp4020-ass2-bada/`. Confirmed in `comp4020-ass2-bada`
  week 7 verifying a home-page copy fix landed. Check `astro.config`'s
  `base` value (or just try the repo-name path) before concluding a preview
  server is serving a broken page.
- An enumeration in a course's own home-page prose ("N times this semester
  ... in a different domain each time: A, B, C...") is a claim to count,
  not just read --- `comp4020-ass2-bada`'s home page said "six times" but
  listed only five domain instances, missing the brief-itself domain
  entirely, present since the file's first commit and missed by several
  prior audits because they checked the domain *names* used (catching the
  earlier "food" mislabel, `2f318ec`) without checking the *count* matched
  the number the sentence itself asserted. Fixed in `comp4020-ass2-bada`
  week 7 (`af3101d`). General check for any content site with a declared
  count anywhere in its prose (six domains, twelve weeks, three
  assessments): count the actual items in the adjacent list against the
  stated number, don't just check each named item is real.
- The "body prose names a specific other week with no `related:` edge
  encoding it" bug (first found between two crit sessions, `2e7855a`)
  recurs across content *types*, not just within one --- an assessment's
  own marking description can make the identical mistake pointing at a
  session. `comp4020-ass2-bada`'s `peer-review-exchange.md` marking
  description said "than the anonymous drafts seen in week 7's crit"
  verbatim, with no `related: [sessions/07-peer-review]`, while every other
  assessment in the same collection with an explicit callback
  (`assignment-1.md` → two lectures, `final-project.md` → a session) did
  carry the edge. General check, now confirmed across content types: for
  any collection of dated content files, grep body/description text for
  "week N" or a named sibling file's title, and check each hit has a
  matching `related:` entry --- don't assume the pattern only applies
  within one content collection just because that's where it was first
  found. Also worth checking before assuming an odd date coincidence is a
  bug: two files sharing a date isn't automatically wrong if the prose on
  one of them explains why (here, an assessment due the same day as a crit
  that explicitly critiques that just-submitted brief) --- read the prose
  before concluding a shared date is drift.
- A `PROCESS.md`-style account with a hard word cap (this brief: 400--600)
  accumulates a backlog of small, real fix commits across deepen runs faster
  than the prose can afford one citation apiece --- `comp4020-ass2-bada`
  carried three uncited fix commits (`0512616`, `8bff82e`, `af3101d`) behind
  a flagged-but-deferred decision across three consecutive hand-offs before
  one run actually resolved it. The brief's own instruction settles it: "one
  narrative... rather than a run of fixes with a commit hash apiece" means
  citing every instance of an already-illustrated pattern is actively
  against the brief, not just a nice-to-have trim. Resolved by folding only
  the newest instance (`6578578`) into the existing illustrative list as one
  more example of the pattern already named, leaving the older three
  uncited (`a2fba8a`) --- word count moved 553→575, still inside the cap.
  General check for any word-capped process account: when a "should I cite
  this too" question gets deferred more than once, that's the signal to
  settle it, not keep re-flagging it, and the settling move is usually "add
  the newest as one more example of a pattern already stated," not "cite
  everything" or "cite nothing new ever again."
- A course-wide `description` string reused as every page's
  `og:description`/meta description (set once in a config file, not
  per-page frontmatter) is worth measuring, not just reading for tone --- a
  length that reads fine as a sentence can still be badly wrong for its
  actual use. `comp4020-ass2-bada`'s course description was 263 characters
  while every hand-authored page description in the built site sat 72--117
  --- it would have truncated mid-word on both a Google search snippet
  (~155 chars) and most social link-preview cards (~200 chars), an outlier
  invisible unless you actually diff description lengths across the site's
  own pages rather than judging the one long one in isolation. Fixed by
  rewriting to 163 characters (`7cc5b7c`, `comp4020-ass2-bada` week 7). Also
  worth checking, and confirmed *not* a bug here: a site's own spaced
  "---" em-dash convention (used pervasively in body content, matching the
  personal writing-style rule "use three dashes for em dashes") may not
  actually be converted to a real em-dash glyph by a configured
  `remark-smartypants` --- `dashes: "oldschool"` expects an unspaced
  `word---word` run, not `word --- word`, so a spaced triple-hyphen renders
  as three literal ASCII hyphens site-wide, every time, by design of the
  mismatch rather than a broken integration. That in turn means the three
  hyphens are individually breakable at a line-wrap (each hyphen is a
  Unicode line-break opportunity), so at some narrow-viewport coincidence a
  "---" run can itself split across two lines ("the work -" / "-specific").
  Confirmed by cropping the actual screenshot pixels, not eyeballing a full
  page render --- a break that subtle is easy to miss at a glance. Decided
  not to chase a fix for this: it's a consistent, long-standing, low-severity
  site-wide quirk (the same "---" convention appears 100+ times in this
  repo's own content and always renders this way), and fixing it would mean
  either editing vendored/fixed theme CSS or hunting every dash instance for
  a rare per-viewport wrap coincidence that content edits reshuffle anyway.
  Worth checking `remark-smartypants`'s configured `dashes` mode against the
  actual spacing convention in use before assuming a "---"-to-em-dash
  pipeline is doing anything at all.
- The HD artefact bar's own examples ("keyboard nav, mid-interaction resize,
  slow connection") are directly checkable against a course site's decks, not
  just its content pages. On `comp4020-ass2-bada` (week 7), reveal.js's
  documented default keyboard bindings (`node_modules/reveal.js/js/
  controllers/keyboard.js`: keyCode 36/35 → `slide(0)`/`slide(lastIndex)`)
  turned out to work for real: dispatching `End` via `agent-browser press`
  and reading `.slides section.present`'s actual text content (not just
  `window.location.hash`, which stayed empty for both `Home` and `End` even
  though the slide genuinely changed --- a vendored reveal.js hash-sync quirk,
  confirmed harmless since the content moved correctly) showed a true jump to
  the last slide. A parallel `agent-browser network route "**/_astro/*.js"
  --abort` check (the slow-connection proxy from `comp4020-ass1-bada`,
  applied here for the first time) found every hand-authored content page
  (home, an assessment, a crit session) rendered completely readable with all
  JS permanently blocked, but the deck (`/decks/week-01/`) rendered as a
  solid blank screen --- reveal.js hides every `<section>` via CSS until its
  own JS adds `.present` on init, so a deck is unconditionally JS-required by
  design. Decided this isn't an actionable finding either: both the hash-sync
  gap and the blank-without-JS behaviour live entirely inside the vendored
  `astromotion`/`reveal.js` packages (`node_modules`), which the assignment's
  own README/doctrine calls fixed --- this repo's only deck-related files are
  the `.deck.mdx` content and a theme stylesheet, neither of which touches
  Reveal's init or keyboard controller. General check for any future
  astromotion-based deck: the "holds up under use it wasn't designed for" bar
  applies straightforwardly to content pages (test with `network route
  --abort` on the JS bundle), but a reveal.js deck's JS-required rendering is
  inherent to the tool, not a per-course regression to chase.
- This template's `course-graph` build plugin auto-mirrors every declared
  `related:` edge --- a lecture's frontmatter naming a session shows up as a
  reverse edge on that session's own `dist/api/index.json` entry even though
  the session's `.md` file never declares it. Confirmed on
  `comp4020-ass2-bada` week 8 by diffing every node's declared frontmatter
  against its built API entry: 15 hand-declared edges became 30 directed
  edges in the graph with zero missing back-edges, for every existing pair.
  This means an audit for "missing back-edge" (A points at B, B doesn't
  point back) is not a live risk on this template --- don't spend time
  checking for it. The real, still-manual risk is different: prose that
  names another week ("the test from week 1," "since week 3's format")
  with *neither* file declaring the edge in *either* direction, so nothing
  mirrors. Found four fresh instances of exactly that gap this way ---
  `sessions/02-revision` citing weeks 1 and 11, `sessions/11-portfolio-
  assembly` citing week 1, `sessions/12-final-crit` citing weeks 3 and 10 ---
  by regex-scanning every node's body/description for "week N" and checking
  the target session id appears in that node's own `related` array, not by
  auditing edge symmetry. Fixed in `comp4020-ass2-bada` week 8 (`e8019f2`),
  one file only needs to declare the edge for the mirror to cover the other
  direction. General check for any future deliverable naming other weeks in
  prose: regex the built API body/description text for a week-number
  pattern, resolve it to that week's node id via the sessions' own `meta.
  week`, and check membership in `related` --- cheaper and more precise
  than eyeballing prose for callbacks.
- A course-website assessment page describing an off-site administrative
  process ("submitted anonymously and redistributed anonymously," "follows
  the university's standard late-submission rule") is not the same claim as
  the ass1-bada drag-copy bug (a page promising an on-page interactive
  affordance it never built) --- it's the same kind of institutional-process
  description any real university assessment page makes, which this course
  site has no mechanism to implement and isn't expected to. Checked
  `comp4020-ass2-bada`'s `peer-review-exchange.md` ("you won't know whose
  work you're reviewing... until marks are returned") against the site's own
  `policies/index.mdx` (which frames late work, extensions and academic
  integrity the identical way, as administrative rules rather than built
  features) before concluding this --- a genuine clean result, not a rubber
  stamp, since the drag-copy precedent made it a real question worth asking.
  General check: before treating a course-site's copy about "what happens
  when you submit" as a testable UI promise, confirm whether the site's own
  policies page treats *all* such submission/marking logistics the same
  way --- if so, it's describing institutional process, not a built feature.
- The source-inaccessible blind cold-read technique (built for interactive
  crit-4/crit-5 instruments/games) generalises cleanly to a static
  multi-page course site: run `pnpm preview` locally (base path derives
  from git origin per this template's `scripts/pages-base.ts`, so the local
  URL isn't bare `/` --- confirm the real path with a `curl` before handing
  it to the subagent), then give a subagent only `agent-browser` (no file
  tools) and the brief's own marker checklist verbatim (home, a few
  non-adjacent weeks, an assessment, the deck, policies, both viewports).
  Run on `comp4020-ass2-bada` for the first time (week 8): came back clean
  --- no broken links, no filler register, deck/lecture and due-date/session
  cross-references all held up --- with one item flagged explicitly as
  uncertain rather than asserted as a bug (a "tested it eleven times by
  week 11" line whose arithmetic reads ambiguously in isolation). Checked
  that one by hand and found both week 1 and week 11's phrasing use the
  same inclusive session-count convention consistently, so it wasn't a
  contradiction. Worth noting for calibration: a well-run blind subagent
  says "uncertain" instead of manufacturing a finding when it isn't sure,
  and that uncertain flag is still worth the two minutes to verify by hand
  even when the overall report is clean --- the earlier crit-5 corrupted-
  report lesson showed one true claim can hide inside an otherwise-wrong
  report, so an otherwise-clean report's one hedge deserves the same
  courtesy in the other direction. Also confirmed on the same run: a bio
  page's claim that a named person "leads" specific sessions isn't
  checkable against a `teachers:`-style frontmatter field that just lists
  attendees with no leadership data at all --- that's an unfalsifiable
  claim, not a contradicted one, and the two are worth distinguishing
  before logging either as a finding. General check for any future
  course-site deliverable with named staff and per-session "who's involved"
  data: only flag a "leads X" bio claim as a bug if something else on the
  site actively contradicts it (names a different leader, or shows the
  claimed leader absent from that session) --- silence isn't contradiction.
- The jsdom-vs-real-browser `color-contrast` gap documented earlier in this
  file for a project's *own* spec tests applies just as much to
  `astro-theme-university`'s built-in a11y check, which every deliverable
  on this theme (crit4, crit5, ass1, ass2 so far) relies on as its main
  automated a11y signal: `node_modules/astro-theme-university/a11y-worker.mjs`
  runs `axe.run()` inside a `JSDOM` instance, so it structurally cannot
  ever flag a contrast bug --- not "hasn't yet," genuinely can't, since
  jsdom has no layout engine to resolve rendered colour against. On
  `comp4020-ass2-bada` (week 8) this let a real, site-wide bug through
  every prior run's "check is green" confidence: the theme's tokens.css
  darkens `--at-link` for light-mode legibility
  (`light-dark(oklch(from var(--at-primary) calc(l - 0.1) c h),
  var(--at-primary))`) but leaves `--at-heading` and `--at-accent` using
  the raw, undarkened primary --- fine for the theme's own default teal,
  but SlopU's brand gold (`#b97d1c`) only reaches 3.43:1 against the page
  background, failing the 4.5:1 AA bar on every heading below "large text"
  size (h3--h6, card titles, a session's "Related" heading) and on all
  accent text (current-page nav indicator, search highlights) --- on
  essentially every page. Found by fetching axe-core fresh from a public
  CDN (never touching another agent's repo, even though a stray
  `find /` for a local copy surfaced several current-week paths under
  other agents' directories) and running it via `agent-browser eval
  --stdin` against a real `pnpm preview` server, the same technique this
  file already documents for jsdom-based *spec* tests, now confirmed to
  generalise to a theme's own bundled a11y tooling too. Fixed by
  reapplying `--at-link`'s own darkening formula to the two buggy tokens
  in a small site-owned CSS file, loaded via the theme's documented
  `brandCss` array extension point (`comp4020-ass2-bada` `6008ee7`) ---
  brought both to 5.18:1. General check for any future deliverable on
  this theme: don't trust "0 accessibility violations" in the build log
  as covering colour contrast at all; run a real-browser axe pass at
  least once, especially after any brand-colour customisation, since a
  theme's own default palette passing AA gives no guarantee a swapped-in
  brand colour will.
- `brandCss` in `astro-theme-university`'s config accepts a `string |
  string[]`, and the array form is how to layer a second, site-owned CSS
  file *after* the brand package's own file (loaded in array order via
  `injectScript("page-ssr", ...)` per spec) --- useful for a small,
  targeted override that shouldn't touch the vendored brand file itself.
  The gotcha: each entry is resolved as an import target from a virtual
  module location, not from the project root, so a relative path
  (`"./src/styles/foo.css"`) fails the build with an unresolved-import
  error while a root-relative path (`"/src/styles/foo.css"`, leading
  slash) resolves correctly via Vite. Confirmed in `comp4020-ass2-bada`
  week 8 fixing the contrast bug above --- the first attempt with a
  relative path broke `pnpm build` outright before the second attempt
  with a root-relative path succeeded.
- Investigating a `find /` result that surfaces paths inside other
  agents' current-week repos (e.g. searching for a locally-cached
  `axe.min.js` to avoid a network fetch) is itself a doctrine-relevant
  moment worth pausing on, not just routing around silently: "never touch
  a repo the prompt did not name" and "never read a current-week
  submission before your own cutoff" both apply to *reading*, not just
  writing, so the safe move is to not open those paths at all and get the
  tool fresh from its actual public source instead (here, jsdelivr's CDN
  for axe-core) --- confirmed as the right call in `comp4020-ass2-bada`
  week 8, no files from other agents' repos were read or copied.
- A CSS `all: unset` reset on a focusable element strips the browser's own
  focus indicator along with everything else it's meant to strip, because
  `outline` isn't an inherited property --- `unset` on a non-inherited
  property resolves to its initial value (`outline-style: none`), not to
  whatever ambient value a `:focus-visible` rule elsewhere would otherwise
  supply. `astro-theme-university`'s footer dark/light toggle button
  (`.at-footer-theme-toggle { all: unset; ... }`) was the only such
  instance across the theme/brand/deck CSS in `comp4020-ass2-bada`, but it
  sits in the shared footer, so it silently broke keyboard focus
  visibility (WCAG 2.4.7) on every single page of the site --- invisible
  to the project's jsdom-based build check for the same structural reason
  `color-contrast` is (no layout engine, so `:focus-visible` computed
  style differences are never checked at all), and only found by actually
  tabbing through a real Chromium page (`agent-browser press Tab`, reading
  `document.activeElement`'s computed `outline`/`boxShadow` after each
  press) and noticing one element out of ~14 had no ring where all the
  others did. Fixed by restating the same outline+ring rule scoped to
  `:focus-visible` on that one class, layered on top via the theme's
  `brandCss` extension point, same mechanism as the earlier contrast fix
  in this file --- confirmed live in both light and dark mode after the
  fix. General check for any project using a CSS reset (`all: unset`,
  `all: revert`, or a hand-rolled button-reset block) on a real
  interactive element: grep for it specifically, then tab to that element
  in a real browser and diff its focused computed style against a known-
  good tabbable element on the same page, rather than assuming a
  project-wide `:focus-visible` rule reaches every focusable thing.
- A multi-path `git add` where one path no longer exists (e.g. already
  renamed by an earlier `git mv` in the same session) errors on that one
  pathspec, but in a Bash tool call without `&&` between statements the
  next line's `git commit` still runs anyway --- and it commits whatever
  *did* get staged, silently, under whatever commit message was written
  for the full intended diff. In `comp4020-ass2-bada` week 8 this produced
  a commit whose message promised a real CSS fix but whose actual diff was
  0 insertions / 0 deletions (only a file rename), because the `contrast-
  fix.css` path in the `git add` was stale from a `git mv` two commands
  earlier. Caught immediately by the standing "always `git show --stat
  HEAD`" habit already in this file, fixed by landing the rest as a clean
  follow-up commit rather than amending. Reinforces: run `git add` with
  paths confirmed to currently exist, one at a time when a rename happened
  earlier in the same sequence, not batched alongside the old path.
- A "fire two requests with `Promise.all`" concurrency test can pass for the
  wrong reason, and the only way to tell is to deliberately break the code
  under test and watch it fail. On `comp4020-crit7-bada` (week 8, `719f90b`)
  the harness's own framing names `db.transaction` as what stops two
  concurrent bookings from both taking the last seat; splitting the same
  check-then-write into two plain `db` calls with no transaction and no
  `await` anywhere between them still passed the new concurrent-booking
  test, because better-sqlite3 is synchronous and Node is single-threaded —
  a function with zero internal `await` points always runs to completion
  before another call to it can start, transaction wrapper or not. Went
  further before trusting that "clean" result: added a real `await` gap
  (`setImmediate`) between the check and the write to simulate a future
  async-driver refactor, and the *same* test still passed — two independent
  raw sockets (bypassing any fetch/undici connection-pool artefact) still
  showed request B's check running only after request A's insert had fully
  landed, serialised, not interleaved. Only widening the simulated gap to
  100ms actually produced the interleaving (both requests read `booked=1`
  before either wrote, both then wrote, oversold by one) — confirmed via a
  trace file written from inside `bookSession` itself
  (`node:fs.appendFileSync`, since the spec's server spawns with
  `stdio: "ignore"` so `console.log` inside it is silently discarded).
  General lesson: a `Promise.all`-driven HTTP concurrency test is not
  guaranteed to make two requests truly overlap inside the server process —
  request-parsing latency can fully serialise them if the async gap being
  tested is shorter than that latency, so passing under `Promise.all` proves
  less than it looks like it proves. For *this* codebase specifically, that
  gap doesn't matter: the shipped `bookSession` has no `await` inside it at
  all, so the real protection is Node's run-to-completion semantics, not the
  transaction syntax — documented as a comment on `bookSession` in `db.ts`
  so a future refactor that adds a real async driver doesn't quietly
  reintroduce the race the transaction wrapper alone won't have caught.
  Worth remembering for any future deliverable with a similar "concurrent
  request" invariant: trust a `Promise.all` test's green result only after
  deliberately widening a simulated async gap in the code under test and
  confirming it actually goes red at some gap size — a gap too small to
  beat request-parsing latency will pass even over genuinely broken code.
- A first blind cold-open pass on `comp4020-crit7-bada` (run 3, week 8) —
  same source-inaccessible subagent protocol used across crit-4/crit-5,
  dev server on a dedicated port so the main thread never touched
  `agent-browser` concurrently — came back fully clean: purpose
  discoverable unaided, booking persists on reload, duplicate rejected
  with clear copy, a full session removes the form entirely rather than
  leaving a disabled button, a second tab's SSE update landed live, mobile
  viewport reflowed correctly. Following the established "after a clean
  cold-open pass, look for a code-level edge case instead of repeating the
  playtest" pattern from crit-4: `bookSession` has four outcomes (ok, full,
  duplicate, not-found) but `spec/bookings.test.ts` only tested three.
  Confirmed by hand first that the untested branch (an unknown `sessionId`)
  already worked correctly (redirects `?error=not-found`, no crash, same
  for a malformed id or empty name) — so this was a coverage gap on
  already-correct behaviour, not a bug, and the fix was purely additive:
  one more regression test (`28fc134`), no app code touched. Worth noting
  as a calibration point alongside the earlier "sixth clean pass is
  legitimate evidence, not proof of an inadequate test" lesson: a *first*
  clean pass on a deliverable is weaker evidence than a sixth one, but
  still doesn't obligate inventing a UI bug to fix — a genuine "nothing
  wrong, but here's an untested-but-correct branch" outcome is a fine
  deepen contribution on its own.
- The 2-way `Promise.all` race test in `spec/bookings.test.ts`
  (`719f90b`) only ever proved the capacity contract holds for exactly two
  concurrent requests at the exact last seat, and only for two *different*
  names — a ninth `comp4020-crit7-bada` run (week 8) widened this along
  two independent axes, both against the real built server (`dist/server`,
  a throwaway DB, the same pattern `spec/global-setup.ts` uses) rather than
  jsdom: an 8-way race for 2 remaining seats (exactly 2 winners, 6 rejected
  `full`, final count landing exactly at capacity, no overshoot or
  undershoot), and — a genuinely untested angle, since the existing
  duplicate-name test only ever calls `book()` twice *sequentially* — a
  6-way race with all six requests carrying the *same* name against a
  session with plenty of headroom (exactly 1 winner, 5 rejected
  `duplicate`). Both passed cleanly first try, confirming the
  single-connection, no-`await`-inside-`bookSession` design generalises
  past 2-way races exactly as the code comment predicts. Promoted both to
  permanent tests (`faaa85e`) rather than leaving them as one-off
  verification, since they close a real gap in what the suite's *name*
  ("lets only one of two simultaneous requests take the last seat")
  actually covers versus what the app's contract claims more generally.
  General check for any concurrency test than only ever fires exactly two
  concurrent requests: the interesting failure modes for a shared mutable
  resource often live at N>2 (does the transaction serialise a genuine pile-up,
  not just a single collision) and at "same identity racing itself" (a
  unique-constraint race is a different code path than a capacity race,
  even though both go through the same transaction) — both are cheap to
  add once the 2-way version already exists, using the same
  boot-the-built-server-against-a-throwaway-db harness.
- `drizzle-kit generate` (this repo's `pnpm db:generate`) is safe to run as
  a pure sanity check, not just when you intend a real schema change --- if
  `schema.ts` and the committed migration files are already in sync, it
  prints "No schema changes, nothing to migrate" and writes nothing, so
  running it costs nothing and leaves `git status` clean. Worth doing once
  per deepen run on any Drizzle project as a check for silent schema drift
  (someone editing `schema.ts` without regenerating/committing the
  migration, which would make a migrate-at-boot deploy diverge from what
  the app code assumes) --- confirmed clean on `comp4020-crit7-bada` week 8,
  a real check, not a rubber stamp, since drift would have shown up as a
  freshly generated (uncommitted) migration file instead.
- Ten prior a11y passes on a page (axe-core, keyboard tab order) can all be
  clean while a completely different accessibility question --- "is the
  page's *live update* mechanism itself accessible, not just its static
  markup" --- goes unasked and fails. `comp4020-crit7-bada`'s SSE handler
  (week 8, `0ecbbd8`) mutated seat counts, an attendee list, and a
  form-vs-"Full" swap via plain `textContent`/`replaceChildren` with no
  `aria-live` anywhere on those regions, so a screen-reader user got zero
  indication the app's own headline feature ("bookings are visible to
  everyone the moment they happen") was doing anything at all --- axe-core
  never flags this because a missing `aria-live` on an element that changes
  later isn't a static-DOM violation at scan time. Compounding it: filling a
  session to capacity from a second tab silently deleted the exact form a
  first tab had focus in via `replaceChildren`, dumping focus to `<body>`
  with zero cue why --- confirmed live with two `agent-browser` tabs
  (`document.activeElement` read immediately after the cross-tab mutation),
  not assumed from reading the code. Fixed by adding `aria-live="polite"` to
  each session's mutating container and, in the SSE handler, checking
  `slot.contains(document.activeElement)` before replacing a filled
  session's form and moving focus onto the new "Full" paragraph
  (`tabIndex = -1` + `.focus()`) only when it actually stole focus ---
  verified this does *not* fire when an unrelated, unfocused session fills
  elsewhere on the page, tested as its own explicit case. General technique
  for any future page with a live/streaming update mechanism (SSE,
  WebSocket, polling) that mutates the DOM after load: two-tab
  `agent-browser` testing --- focus a specific element in tab A, trigger the
  mutation from tab B, read `document.activeElement` and `aria-live`
  presence in tab A --- answers a question a single-tab cold-open playtest
  or a static axe scan structurally cannot.
- A redirect that builds a URL with a query param the receiving page never
  reads is a real, previously-invisible gap on its own --- worth grepping
  for on any server that redirects with structured state, not just checking
  the redirect status code. `comp4020-crit7-bada`'s `bookings.ts` POST
  handler has appended `session=${sessionId}` to every failure redirect
  since the repo's very first commit (`cff9e1c`), but `index.astro` never
  read it, so a rejected booking (full, duplicate, unknown session) only
  ever surfaced a generic top-of-page banner with no indication of *which*
  session it was about --- invisible to eleven prior runs' cold-opens, a11y
  passes and code reviews because it's not a crash, just a discarded
  signal. Found by reading `bookings.ts` closely and grepping whether
  anything in `src/` ever read `params.get("session")` --- nothing did.
  Fixed (week 8, `f7baee5`) by wiring the existing param through a URL
  fragment (`#session-<id>`) instead of inventing a new mechanism: gave each
  session `<li>` a matching `id`, a highlight class keyed off the query
  param, and `tabindex="-1"` so native fragment navigation actually lands
  browser focus there --- no client JS needed, matching the rest of the
  app's plain-POST-and-redirect ethos. Confirmed live with `agent-browser`
  (booked a name twice, read `document.activeElement` and the highlighted
  `<li>`'s class, screenshotted the result) before committing, not assumed
  from the diff. General check: grep any redirect target for a query param
  it constructs, then grep the receiving page for whether that param is
  ever actually read --- a param that's *sent* isn't evidence it's *used*.
  Same run, separately: confirmed (not just assumed from the code comment)
  that the event bus's single-machine assumption is actually enforced in
  both deploy paths, not just documented --- `fly.toml`'s own header and
  `.github/workflows/checks.yml`'s `deploy` job both pass `--ha=false`, no
  drift between the manual and CI deploy commands. No code change; a real
  checked-and-clean result, since the two could easily have drifted (one
  updated, the other not) without anyone noticing until a second machine
  silently split the SSE bus.
- A stated app contract is worth checking literally, not just testing the
  behaviour it implies --- `comp4020-crit7-bada`'s README says duplicate
  prevention is "a unique constraint on (session_id, person_name), enforced
  by the database," but the constraint was on the raw typed name, so
  booking "Ada" then "ADA" into the same session succeeded as two separate
  people. Twelve prior runs' concurrency races, cold-opens and a11y passes
  never caught this because it's not a crash or a visible break, and every
  existing test only ever repeated the identical string. Found by reading
  the schema against the README's own claim, not by another playtest. Fixed
  (week 8) with a SQLite virtual generated column
  (`lower(trim(person_name))`) carrying the unique index, keeping the raw
  `personName` column for display, plus the matching change to the
  app-level duplicate check inside `bookSession`. Real drizzle-kit/SQLite
  gotcha hit along the way: `generatedAlwaysAs(..., { mode: "stored" })`
  makes `drizzle-kit generate` print a `[Warning]` (SQLite can't
  `ALTER TABLE ADD COLUMN` a STORED generated column, only a VIRTUAL one)
  and then silently emit a broken migration --- it drops the old unique
  index and creates the new one, but never emits the `ADD COLUMN` statement
  at all, so applying it to any already-migrated database throws "no such
  column" outright. `mode: "virtual"` instead generates a working
  `ALTER TABLE ... ADD ... GENERATED ALWAYS AS (...) VIRTUAL` statement, and
  a `CREATE UNIQUE INDEX` on a virtual generated column is valid SQLite (the
  restriction is only on an inline `UNIQUE`/`PRIMARY KEY` table constraint,
  which is not what drizzle's `unique().on(...)` compiles to anyway).
  Verified the upgrade path for real, not just against a fresh database:
  bootstrapped a throwaway DB through the *old* migration set to get
  drizzle's own `__drizzle_migrations` bookkeeping table populated
  correctly (seeding by hand with raw SQL skips that table and produces a
  misleading "table already exists" failure that looks like a migration
  bug but is actually just an artefact of the test harness), inserted a
  real booking row, then ran the *new* migration set on top and confirmed
  it applied cleanly and the generated column backfilled correctly for the
  pre-existing row. Before deploying, also queried the actual production
  volume over `flyctl ssh console` (needed `flyctl machine start` first —
  the machine was auto-stopped — and a `node -e` one-liner against
  `better-sqlite3`, since the deployed image has no `sqlite3` binary) to
  confirm zero real bookings existed there, so the new constraint couldn't
  conflict with anything already on disk. Deployed, boot logs clean, no
  test booking left on the live volume (checked the page loads correctly
  without ever submitting the form against production, matching the
  standing rule elsewhere in this file about not leaving junk data on a
  volume with no delete/cancel). General technique: any future
  `generatedAlwaysAs` column meant to be added to an *existing* SQLite
  table via a later migration (as opposed to being present in the very
  first `CREATE TABLE`) must use `mode: "virtual"`, never `"stored"` --- and
  always test the upgrade path against a database that went through the
  real prior migration set, not one seeded by hand, since hand-seeding
  bypasses drizzle's own migration-tracking table and produces a false
  "table already exists" failure that has nothing to do with the migration
  itself.
- The case-fold bug family on `comp4020-crit7-bada` went a third layer deep:
  after ASCII case (`dc0d99a`) and non-ASCII case (`36417f9`), a tenth run
  (week 8) checked Unicode normalization form specifically because a
  previous run's own hand-off named it as the next thing to try --- and it
  was real. "Café" typed as a precomposed `é` (U+00E9) vs. the same glyph
  typed as `e` + a combining acute accent (U+0301) are visually identical
  but byte-distinct strings until normalized, so `.trim().toLowerCase()`
  alone let them double-book, on both the SQL-backing `name_key()` function
  and the app-level pre-check, the same shape as both prior layers. Fixed
  by adding `.normalize("NFC")` before the existing trim/lowercase on both
  sides (`9cf3082`). No migration needed --- `pnpm db:generate` reported "no
  schema changes," confirming a `mode: "virtual"` generated column
  re-evaluates its expression against whatever function is registered at
  read time, so a pure JS-function change never touches the schema/migration
  layer at all. Worth treating this bug family as probably exhausted after
  three layers (ASCII case, non-ASCII case, normalization form) --- a further
  layer (grapheme-cluster equivalence, ZWJ tricks) is a much longer tail for
  much less real-world relevance to an ANU population, and three consecutive
  deepen runs drilling the same bug family is itself a signal to rotate the
  lens rather than confirmation to keep drilling.
- Retyping the same accented character (e.g. "Café") across different tool
  parameters within one session can silently produce different underlying
  Unicode byte sequences (NFC vs NFD) --- `Edit`'s exact-string-match then
  fails with "string not found" even though the `old_string` looks byte-
  identical to the file's content on a `Read`. Confirmed on
  `comp4020-crit7-bada` writing the NFC/NFD regression test itself, which is
  exactly the kind of file where this bites hardest since the whole test's
  point is having two byte-distinct-but-visually-identical strings in the
  same file. Fix: don't retry the same literal-character `Edit` call hoping
  it resolves --- write the intended text using explicit `\uXXXX` escape
  sequences instead (e.g. `"Café"` / `"Café"`), splicing them in
  with a `node -e` script if `Edit`'s own text argument is what keeps
  drifting. Escapes are unambiguous in a way that typing the actual glyph
  never is once a session has already produced both normalization forms of
  it once.
- A new test that fully drains a session for its own assertion (found via
  `findSessionWithSpareCapacity(n)`, then a filler loop to leave it exactly
  full) silently competes with every other test in the same file for the
  same finite pool of seed-data seats --- inserting one *mid-file* can starve
  a *later*, unrelated test that also calls `findSessionWithSpareCapacity()`
  and assumes there's still something left. Hit on `comp4020-crit7-bada`
  (week 8) adding the NFC/NFD test between two existing tests: it broke a
  downstream race test with "expected [] to have a length of 1 but got +0",
  nothing to do with Unicode at all. Diagnosed with a temporary `afterEach`
  hook logging every session's booked/capacity state after each test, run
  with `pnpm exec vitest run --reporter=verbose` (the default reporter
  swallows `console` output for passing tests, so verbose is required to see
  the trace at all) --- this reconstructs exactly how the suite's total seat
  budget gets consumed test-by-test and pinpoints which test tipped it into
  deficit. Fixed by repositioning the new test near the end of the file
  (after the last test that assumes fresh/zero-booked state) and dropping
  its own filler loop entirely, rather than touching seed data or weakening
  any assertion. General check for any spec suite sharing one seeded
  database across sequential tests via a "find one with spare capacity"
  helper: a new fully-draining test's position in file order matters as
  much as its own logic --- verify with the `afterEach`-plus-`--reporter=
  verbose` trace before assuming a failure introduced elsewhere in the same
  run is unrelated to a new test just added nearby.
- A schema/function change to a duplicate-key check that can only ever make
  MORE strings collide (never fewer) --- like tightening a case-fold or
  normalization rule --- carries no data-migration risk against existing
  rows: SQLite doesn't retroactively re-validate already-stored rows against
  a changed generated-column expression, the unique constraint only fires at
  INSERT time against rows already in the table. So the standard "check the
  production volume before deploying a duplicate-constraint change" ritual
  documented elsewhere in this file is precautionary, not load-bearing, for
  this specific class of change (unlike a genuine schema/column-shape
  change) --- worth still doing it once as cheap due diligence
  (`comp4020-crit7-bada` week 8, confirmed zero real bookings again before
  the normalization fix went out), but not worth treating a skip of it as a
  real risk if time is tight and the fix is provably monotonic in what it
  rejects.
- Node 24.21.0 (this course template's pinned version, per `mise.toml`) has
  two built-ins worth reaching for before adding a dependency or a Docker
  build step: `node:sqlite` (`import { DatabaseSync } from "node:sqlite"`)
  gives a synchronous SQLite binding with no native addon at all --- no
  node-gyp, no prebuilt-binary-per-platform risk, none of the
  `better-sqlite3`/drizzle Docker complexity documented at length elsewhere
  in this file for other course repos --- and plain `.ts` files run directly
  via `node src/whatever.ts` with no build step, since Node's default type
  stripping handles ordinary TypeScript (no enums/namespaces needing real
  transformation) unflagged. Together these let a Fly Dockerfile skip a
  build stage entirely: install prod deps, copy source, `CMD ["node",
  "src/server.ts"]`. Confirmed working end-to-end (typecheck, tests, a real
  `docker build`+`run`+`restart` persistence check, and a live Fly deploy)
  in `comp4020-final-bada` week 9. Worth defaulting to this combination for
  any future from-scratch Node deliverable on this course's Fly template
  before reaching for `better-sqlite3` again.
- This sandbox's shell is zsh, and zsh arrays are 1-indexed by default ---
  a `for i in $(seq 1 N)` loop generating test POST bodies with
  `${names[$((RANDOM % ${#names[@]}))]}` (correct bash, 0-indexed) silently
  produced an empty name on every draw of index 0 in zsh, since
  `${names[0]}` is unset --- no error, just a request with an empty `name`
  field that the app then correctly rejected, so the failure showed up as a
  mysteriously smaller row count in the database than requests sent, not as
  a shell error. Confirmed on `comp4020-final-bada` week 9 generating 50
  synthetic posts to stress-test a wall UI at volume: 4 of 50 draws came up
  empty. Fix: either index from 1 in any array-literal test-data loop in
  this environment, or avoid the ambiguity entirely with a plain
  space-separated string and `set --`/positional-parameter cycling. Worth
  checking any future ad-hoc data-generation loop's actual output count
  against the expected count before trusting "N requests sent" means "N
  rows landed," especially before concluding a discrepancy is an app bug.
- The ZWSP/`Cf`-character emptiness-check bug (first found on
  `comp4020-crit7-bada`'s booking form) recurred independently on
  `comp4020-final-bada` (week 9, `7cc1341`): a mark's `name`/`body` fields
  used `.trim()` then a truthiness check, so a string made only of U+200B
  passed both the client's implicit expectation and the server guard,
  posting a mark that read as blank on a wall whose whole point is an
  honest, visible trace. Same fix (`/[^\s\p{Cf}]/u.test(s)` alongside the
  existing checks). Two independent recurrences across two different course
  repos makes this worth checking as a default, not a speculative edge
  case, on any future form whose only emptiness guard is `.trim()` plus
  truthiness.
- A first real-browser axe-core pass on `comp4020-final-bada` (week 9,
  `defaffb`) found the `region` rule flags page content not contained by any
  landmark (`<header>`/`<main>`/`<nav>`/etc.) --- the home page's posting
  `<form>` sat directly between `<header>` and `<main>` as a bare sibling,
  so its two fields weren't inside either landmark even though the page
  visually looked complete and correctly structured. `/readme/` (pure
  markdown-rendered content inside one `<main>`) was already clean, so this
  only showed up on the one page with content genuinely outside a single
  wrapping landmark. Fixed by moving the form inside `<main>`, next to the
  wall it posts to --- a one-line move, no markup removed or added. General
  check for any hand-rolled page template (not a framework/theme where a
  layout component already wraps everything): confirm every top-level
  sibling of `<body>`'s children is inside exactly one landmark, don't
  assume a page "looks fine" structurally means axe's landmark-containment
  rule is satisfied.
- Verified on `comp4020-final-bada` (week 9): 40 concurrent `Promise.all`
  POSTs against a `node:sqlite` `DatabaseSync`-backed server all landed with
  contiguous, non-duplicate ids and no corruption, confirmed by querying the
  sqlite file directly rather than trusting the rendered page alone. Same
  reasoning as the `better-sqlite3`/`Promise.all`-race lesson elsewhere in
  this file: a synchronous DB client with zero `await` inside the insert
  function can't interleave two calls regardless of how many requests race
  in, since Node's run-to-completion semantics serialise them. Worth
  confirming this directly (not just assuming it from the driver being
  synchronous) on any future `node:sqlite`/`better-sqlite3` schema before
  trusting it holds under real concurrent load, even one with no
  capacity/uniqueness constraint to race over.
- Hand-rolled cookie parsing that calls `decodeURIComponent` on a raw cookie
  value with no try/catch can take down an entire request, not just corrupt
  one field --- a stray `%` not followed by two hex digits (hand-edited in
  browser devtools, a stale value left over from a past encoding scheme)
  makes `decodeURIComponent` throw `URIError`, and if that call sits ahead
  of the route handler (reading an identity cookie before dispatching on
  method/path, as in any cookie-based-session design), the throw aborts the
  request before a response --- including a plain `GET /` --- is ever sent.
  Worse than a one-off 500: since the crash happens before the handler ever
  reaches a `Set-Cookie` that could overwrite the bad value, the same
  client's *next* request carries the identical malformed cookie and 500s
  again, forever, until they clear cookies by hand --- a permanent lockout,
  not a transient error. Found on `comp4020-final-bada` (week 9, `257c251`)
  by tracing every uncaught-throw path in the request handler by hand
  (reading the code for `JSON.parse`/`decodeURIComponent`/similar calls with
  no surrounding try/catch) and testing each with a raw `curl -H "Cookie:
  visitor=%"`, not found by any playtest or a11y pass --- a malformed cookie
  is not something a cold-open browser session naturally produces. Fixed by
  wrapping the per-cookie decode in try/catch and treating an undecodable
  value as absent, the same "degrade gracefully" response as any other
  malformed-client-input case. General check for any app with its own
  cookie/header parsing (not using a framework's battle-tested cookie
  library): grep for decode/parse calls on client-controlled header values
  with no try/catch nearby, then verify each with a deliberately malformed
  value sent via `curl`, especially any such call that runs ahead of normal
  routing --- a crash there is categorically worse than a crash inside a
  single route, since it can take out every route for that client at once,
  and worth distinguishing from a one-off attack-shaped failure (e.g. an
  oversized body) which doesn't persist across requests the way a bad
  cookie does.
- For an SSE feed over a table that's append-only, the reconnect-gap fix is
  to make the SSE `id:` the row id and replay `where id > Last-Event-ID` on
  connect. The browser sends the header automatically on reconnect, and
  there's no in-memory backlog to lose on restart. A page passes its own
  starting point as `?after=<max rendered id>` for the first connect, which
  covers a post landing between render and connect. Gotcha:
  `Number(searchParams.get("after"))` is `Number(null) === 0`, which replays
  the entire history to a client that sent no starting point. Default to
  `NaN` instead. Done in `comp4020-final-bada` crit 9 and verified through
  Fly's proxy, where streaming isn't buffered and 25 s comment pings hold it
  open.
- A browser `EventSource` only auto-retries network errors. If a reconnect
  gets any non-stream answer (a 502/503 from a proxy while the one machine
  restarts on a deploy), it goes `CLOSED` for good and the tab stays dead
  after the server is back. Reproduce locally: open the page, kill the
  server, bind a two-line 503 stub to the same port for a few seconds,
  then restart the real server and post. Fix: on `error` with
  `readyState === CLOSED`, reopen with backoff from the newest id already
  shown (`?after=`, since a fresh `EventSource` sends no
  `Last-Event-ID`), and reopen straight away on `visibilitychange` to
  visible. Done in `comp4020-final-bada` crit 9, with a jsdom test that
  runs the served page and `/live.js` against a stand-in `EventSource`
  and a captured `setTimeout`. Reverting the fix turns the test red.
