# Marks grows into a tree: weekly roots, threaded marks, and a WebGL archive

You're picking up Marks as it stood at crit 8: one flat wall of short marks,
server-rendered, `node:sqlite` on the Fly volume, no build step. Read
`README.md`, `CLAUDE.md`, `src/` and `spec/` first. They're small.

This run turns the flat wall into a **tree that grows week by week**. It also
adds an **Archive** you fly through in 3D with the arrow keys. We want this
to be novel and a bit over the top. Nobody is around to answer questions, so
where this prompt leaves something open, make the call and explain it in the
commit message.

## The idea in one paragraph

Every mark can have marks under it, so any mark works as its own little wall.
Each week has an auto-created **root mark**. Everything posted on the home
page that week hangs directly under it. At **00:00 Monday, Australia/Sydney
time**, that week is archived: it becomes read-only for good, and a new root
takes its place. The roots are chained: the current week's root is the top of
the whole tree, and its **leftmost child is last week's root**, whose leftmost
child is the week before that, and so on back to the first week. So the whole
history is one tree. It reads like a linked list of weeks down the left edge,
with each week's discussion branching off to the right. The home page shows
the current week's root. The Archive lets you travel the whole tree.

## Data model

- Keep one `marks` table. Week roots are rows in it too, so "every mark is its
  own root" holds everywhere. A root has a system author (show it as something
  like "Marks"), and its body is a label such as `Week of 5 Oct 2026`.
- Store the tree as a **parent pointer** (`parent_id`). That's the normalised
  SQL form of "each mark has an array of pointers to the marks under it": a
  mark's children are `where parent_id = ?`. Nothing ever rewrites an array,
  so two people posting at once can't race on it. In the archive API and the
  client, *present* the tree as children arrays, because that's the mental
  model.
- Add a small `weeks` table (or the equivalent): `week_start` (unique, the
  Monday's date in Sydney), `root_mark_id`, and the previous week. The
  previous-week link is the root's leftmost-child edge. Each mark also records
  which week it belongs to, so "is this archived?" is a single lookup.
- **Rollover is lazy, not a cron job.** The Fly machine auto-stops when idle
  (`fly.toml`), so nothing would be running at 00:00 Monday to fire a timer.
  On each request, work out the current week from the clock. If it has no
  root yet, create one inside a transaction and chain it to the most recent
  week. The unique index on `week_start` plus the synchronous DB keeps this
  idempotent under concurrent first requests. Empty weeks in between (nobody
  visited) don't need roots. Chain to whichever week actually came before.
- Put week arithmetic in a **pure module** (for example `src/week.ts`) that
  takes a `Date` and returns that week's Monday-00:00-Sydney start. It must be
  correct across DST: Sydney's offset is +10 or +11, and DST started on
  4 Oct 2026. Use `Intl`, not a hard-coded offset.
- **Migrate existing data at boot, idempotently.** The live volume already has
  real marks from the crit. Add the new columns and tables in a way that's safe
  on an already-populated database. Assign every existing parentless mark to
  the week its `created_at` falls in (creating and chaining those week roots).
  Never drop or rewrite a real mark's name or body. Test the upgrade by
  booting the *old* code against a scratch `DATA_DIR`, posting marks, then
  booting the new code on the same file.
- Archived means sealed. A POST under any mark in a past week is rejected and
  stores nothing. It's a 403 (or a redirect with a clear notice) and the
  form simply isn't rendered on archived pages. Marks remain permanent: no
  edit, no delete.

## Pages (server-rendered, all working with JS off)

- Every page has a top `<nav>` with two links: **Home** and **Archive**. Mark
  the current one with `aria-current`. Keep `/readme/` reachable (the footer is
  fine).
- `/` is the current week's root mark page: the week label, the posting form,
  and its direct children as the wall, newest first. **Don't** show last
  week's root here as a child. On the home page the previous-week link is
  plumbing, not content. Each mark on a wall shows its reply count and links to
  its own page.
- `/m/<id>` is any mark's page. Show a breadcrumb of its ancestors up to the
  week root, the mark itself, a reply form (current week only), and its
  children as a wall. Add a "Find in archive" link that opens the Archive
  focused on this mark. Requesting a week root's id directly works too. 404
  for unknown or malformed ids.
- `/archive/` without JS shows the whole tree as nested lists, newest week
  first, each week a `<details>` you can expand, every mark a link to its
  page. This is the real fallback and the screen-reader view, not an
  afterthought.
- `/archive.json` returns weeks plus marks (`id`, `parentId`, `weekId`, `name`,
  `body`, `createdAt`, `childCount`). It must **never** include `visitor_id`.
  The whole tree in one response is fine at this room's scale.
- Keep `escapeHtml` on every server-rendered user string. On the client, user
  text only ever goes in via `textContent` or equivalent, never `innerHTML`.

## The Archive: the centrepiece

JS turns `/archive/` into a full-viewport **three.js** scene that feels like a
**living tree you travel through**. Add `three` as a real `dependency` (Docker
installs `--prod`), update the lockfile, and serve it yourself from
`node_modules` through the server with an import map: no CDN and no bundler.
Client code goes in plain ES modules served from a static directory. Update
the `Dockerfile` so they ship. Set sensible content types and cache headers.

**Shape.** Lay it out as the data model says. The current week's root is at
the top. Older weeks step down and to the left along a heavier "spine" edge,
like a trunk or a staircase into the past. Each week's marks branch out to
the right and downward, with replies branching further. Use real depth:
perspective, a gentle tilt, fog so the distant past fades out. A spiral or
helix for the spine is fine if it reads better. Your call, just keep "left =
older" legible.

**Bubbles.** Each node is a bubble with a short readable summary. A week root
shows its label plus the first mark of that week. A mark shows the author and
the first line or so of the body. Render bubble text as real DOM via
`CSS2DRenderer`/`CSS3DRenderer` (crisp, selectable, escaped by
`textContent`), not as text baked into textures. If the tree gets big, cull or
fade labels far from the camera.

**Preview.** Hovering a bubble with a mouse, or selecting it with the
keyboard, expands a preview card: full body, author, time, reply count, and
"Open" (goes to `/m/<id>`).

**Tree-like animation, the novel part.**
- On load the tree *grows*: branches extend from the current root outward,
  bubbles bloom as their branch reaches them, older weeks unfurl down the
  spine.
- Moving between nodes is a camera flight along the actual edges, not a
  teleport. Going from A to B travels up to their common ancestor and back
  down, like walking a linked list. A pulse of light runs along each edge of
  the path ahead of the camera.
- Add ambient life: soft bloom, slight sway in the branches, particles
  drifting down the spine. Go overkill, but keep it at 60 fps on a normal
  laptop with a few hundred nodes.
- `prefers-reduced-motion`: no growth animation, no sway or particles, and
  the camera cuts or quick-fades instead of flying.

**Keyboard (primary).** One consistent rule:
- **↑** goes to the parent. From a week root, ↑ goes to the next *newer*
  week's root, since that's its parent in the chain.
- **↓** goes to the first child (the first real mark, not the previous-week
  edge).
- **← / →** move between siblings. Under a week root, the previous-week root
  is the leftmost sibling, so pressing ← past the first mark steps into last
  week. That's the novelty: time is just "further left".
- **[ / ]** (or PageDown/PageUp) jump straight between week roots.
- **Enter** opens the selected mark's page. **Esc** goes up a level. **Home**
  flies back to the current week's root.
- Show a small, unobtrusive key legend. The canvas must not swallow keys
  aimed at other focused elements, like the nav links or the preview's Open
  link.

**Mouse and touch fallback.** It's allowed to be a bit worse, but it must
work. Click or tap a bubble to select it and fly there. Click or tap the
selected one again, or use its preview's Open link, to open it. Drag to pan or
orbit (constrained so you can't get lost), and wheel or pinch to zoom. Add an
on-screen D-pad of real `<button>`s that maps to ↑↓←→. Swipes are a nice
extra.

**Deep links.** `/archive/#m-<id>` (or `?at=<id>`) opens focused on that mark,
and the URL updates as you move, without flooding history. "Find in archive"
on mark pages uses this.

**Accessibility and graceful failure.**
- The canvas is `aria-hidden`. An `aria-live="polite"` region announces the
  selection, e.g. "Week of 28 Sep 2026, mark by Ana: '…', 3 replies, Enter to
  open".
- The nested-list view stays in the page behind a "List view" toggle, so
  screen readers and anyone who prefers it get the same tree.
- If WebGL isn't available, or three.js fails to load, fall back to the list
  view with a one-line note. Zero console errors in either path.

## Rules that change, and rules that stay

This prompt overrides parts of `CLAUDE.md`'s "Marks" rules and the README's
stance ("the wall doesn't paginate, filter, or rank", "build to the crit
that's open", "keep dependencies to what's load-bearing"). The README says it
has to change first, so do that: **rewrite `README.md`** to argue for the
weekly tree and archive (why a week is a good unit for a small room, why
sealing a week is an honest promise). Keep at least one heading-bearing
section so `/readme/` still passes. Then **update the rules in `CLAUDE.md`
below the `---` line** to match: three.js is the one new load-bearing
dependency, and the archive is the one place JS is required (with the list
fallback). Leave the riff block above the line exactly as it is.

These stay: no accounts (the cookie visitor id still badges "yours"), marks
are permanent, `escapeHtml` everywhere, one SQLite file on `/data`, no
ORM, no build step, and the home page and mark pages work fully with JS off.
Real-time updates are out of scope for this run.

## Tests (`pnpm check` must be green)

- Keep `spec/invariants.test.ts` green and unchanged.
- Rewrite `spec/marks.test.ts` for the new model, against the running app:
  - posting on `/` shows up on `/`
  - replying on `/m/<id>` shows up there and not on `/`
  - reply counts are right
  - posting to a non-existent parent stores nothing
  - `/archive/` lists the current week and is valid without JS
  - `/archive.json` has the right shape and contains no `visitor_id`
  - the zero-width and malformed-cookie cases still hold
- Add pure unit tests for the week module: Monday 00:00 boundaries either
  side, the DST transitions in October and April, and a Sunday 23:59 versus
  Monday 00:00 pair. These import the module directly and don't need the
  server, which is fine under the existing config.
- Archival can't be tested end-to-end against the running app without
  faking the clock. Cover the "archived parent rejects posts" logic with a
  unit test against the DB layer using a scratch `DATA_DIR`, or a clock you
  inject, never with a time override that ships enabled in production.

## Verify it for real

- Add a **local-only** seed script (for example `scripts/seed.ts`). It fills a
  scratch `DATA_DIR` with roughly 6–8 backdated weeks, a few dozen marks and
  some replies at least 3–4 deep, so the archive has something to fly
  through. Never run it against production.
- In a real browser at 1920×1080 and 390×844, walk the Archive with the
  keyboard alone: every arrow at every edge case (leftmost sibling, oldest
  week, leaf with no children, ↑ from the current root). Then use mouse and
  touch emulation, reduced motion, WebGL disabled, and JS disabled. Headless
  Chrome may need SwiftShader flags for WebGL. Confirm the canvas actually
  draws (sample pixels) before trusting a screenshot.
- Check the migration against a database created by the *old* code, as
  described above.
- Run an axe pass on `/`, `/m/<id>`, `/archive/` and `/readme/`.

## What good looks like

Someone opens the live site, posts a mark, replies to someone else's, then
hits Archive and watches the tree grow. Pressing ← a few times carries them
gracefully into last week's conversation. Hovering a bubble shows the whole
mark, and Enter takes them to its page. It feels like a place, not a list,
and none of it breaks without JS or WebGL.

## Leave alone

`agent/`, `.github/`, `fly.toml`, `spec/invariants.test.ts`, the riff block at
the top of `CLAUDE.md`, and `reflections/`. Don't deploy and don't push.
Commit as you go with clear messages that record the decisions you made, keep
`main` deployable, and **delete this `prompt.md` in your last commit**.
