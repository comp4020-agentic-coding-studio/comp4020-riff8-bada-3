# Marks

Marks is a shared noticeboard for a small, specific room: a crit group, and
whoever else wanders in. Type a name and a short line and it joins everyone
else's. Reply to any mark and that mark becomes a little wall of its own. At
midnight on Monday, Sydney time, the week is sealed into the archive, and a
fresh one starts.

## What good means here

Good, for this app, isn't "used by many people." [Robin Sloan's *An App Can
Be a Home-Cooked Meal*](https://www.robinsloan.com/notes/home-cooked-app/)
argues that software doesn't need scale or a business model to be worth
building. It can be made, like a meal, for people you actually know, and
judged by whether it serves them rather than whether it grows. Marks is built
for a room of a dozen people, not a public feed. [Ink & Switch's *Malleable
Software*](https://www.inkandswitch.com/essay/malleable-software/) holds the
same idea at another scale: tools shaped for exactly the work in front of
them. That's the standard for the schema too. It should be the smallest shape
that carries what the room does.

So there are still no accounts. A visitor is a random id in a cookie, set the
first time they show up. That's enough to tell two people apart and to badge a
mark as "yours" when you're back, but not to verify anyone. A name is just a
label someone types.

## Why a week

A flat wall worked for one crit. It doesn't survive a semester. After a few
weeks, reading top to bottom stops being the whole interface and becomes a
scroll past things everyone has already read. Pagination or ranking would
have fixed the length but not the shape.

A week is the room's own unit. The crit meets weekly, the briefs turn over
weekly, and a conversation about this week's work mostly belongs to this
week. So every week gets a **root mark**. Everything posted on the home page
hangs under it, and anything can be replied to, so a thread grows down from
whatever started it. The home page only ever shows this week, which keeps it
short for the same reason the original wall was short.

## Why sealing is an honest promise

At 00:00 Monday the week is archived, and archived means read-only for good:
no new marks, no replies, no edits. Marks were always permanent. Sealing
extends that from "you can't take it back" to "the conversation is over",
which is a promise about the past that the app can actually keep. When you
read last week, you're reading what it was, and nobody can quietly add to it
afterwards to change what it meant.

Nothing runs at midnight to do this. The app's machine sleeps when nobody's
using it, so the first visit after Monday 00:00 notices the new week and
creates its root. Weeks nobody visited don't get one.

## The tree and the archive

Each week's root has last week's root as its leftmost child, so the whole
history is one tree. Read down the left edge and it's a linked list of weeks.
Branch right and you're in a week's conversation. The **Archive** lets you
travel it. With JavaScript and WebGL it's a 3D tree you fly through with the
arrow keys: ↑ to a mark's parent, ↓ into its replies, ← and → between
siblings. Pressing ← past a week's first mark carries you into the week
before, because in this tree the past is just further left. **Older week**
and **Newer week** buttons (and `[` `]`) step along the weeks directly, so a
phone, or an empty week with nothing to step left from, can still reach all
of history. Without JavaScript or WebGL it's the same tree as nested lists,
one expandable section per week. That's also the view screen readers get, and
the one the page falls back to, with a one-line reason, if the 3D view can't
load, can't start, loses its graphics context, or is handed a tree too big to
draw well. The list is never hidden until the tree is actually running.

The archive is the one place the app needs JavaScript, and the one place it
takes on a real dependency: three.js, served straight from the app's own
`node_modules` without a CDN or a build step. Posting, replying and reading a
mark all work with scripts off.

## Writing a mark

A name can be up to 40 characters and a mark up to 280, counted the way the
browser's own `maxlength` counts them (UTF-16 code units), so the form and
the server never disagree: most emoji count as two, and a line break counts
as one. A mark is permanent, so the server never shortens anything to fit.
Too long, blank, or only invisible characters, and the form comes back with
the problem next to the field and your draft still in it.

## Who can do what

There are no accounts. A visitor is a random id in a first-party cookie, set
the first time a browser shows up; a name is only a label someone types. So:

- **anyone can read everything**, every week, every mark
- **anyone can add** a mark or a reply, but only to the current week
- **nobody can add to a sealed week**: the moment 00:00 Monday passes, a
  reply under an older mark is refused (403), even one typed on Sunday and
  sent a second after midnight, and the draft comes back with an offer to
  post it on the new week instead
- **nobody can edit or delete** anything, their own marks included

The server enforces all of it in `src/db.ts` (`post()` decides the week and
writes in one transaction, against the clock as it reads after the request
has arrived) and `src/app.ts` (`handlePost()` validates before that). Being
"yours" only decides the badge and the colour you see; it grants nothing.

The limits are those of a cookie. Clearing it, or opening a private window,
makes you a new visitor; two people on one browser are one visitor; and
anyone can type any name. That is enough for a room of a dozen people who
know each other, and it is all this app claims.

## Live, in every open tab

Open pages update themselves. A new mark or reply appears within about a
second on every page that shows it, and counts change in place, without a
reload and without touching anything you're typing. It's server-sent events
from the same Node process (`/events`, `src/live.ts`), with no new
dependency or service. A small line at the top of each page says whether
it's live.

The feed is just the `marks` table read forward: marks are append-only, so
every new row, a new week's root included, is an event whose id is its row
id. Order is the order of the writes, and two marks posted at the same
moment get distinct, ordered ids, so nothing is lost or shown twice. When a
connection drops, the browser reconnects and says which id it saw last, and
the server replays everything after it from the table, with counts as they
are now. If a deploy answers with an error page instead, the page keeps
retrying until the server is back. Each listener gets its own copy of every
event, so "yours" is worked out for the person listening, and visitor ids
are never sent.

Nothing on the server watches the clock. A page that's open at midnight
reconnects just after it, and that request is what creates the new week;
then every open page hears about it. The home page moves on to the new week
and a page under the old one seals, keeping any draft.

## The activity log

Every request that matters leaves one JSON line on stdout, which is what
`flyctl logs` shows, and the same event in an `audit` table in the SQLite
file, so it's still there after a restart. A line looks like:

```json
{"ts":"2026-10-12T10:41:55.441Z","rid":"ad622127","actor":"v-00961c4886","action":"mark.reply","outcome":"ok","mark":162,"parent":131,"week":7,"name":"Bo","name_chars":2,"body_chars":17,"preview":"Respectfully: no.","parent_actor":"v-68c276531a"}
```

`actor` is a short hash of the visitor cookie: stable for one browser,
different for the next, never the cookie itself. `rid` ties every line from
one request together, and a visitor who hits an error sees the same id on
the error page. The actions are `page.view`, `mark.post`, `mark.reply`,
`week.rollover`, `live.catchup` and `request.error`; a rejection has
`outcome: "rejected"` and a `reason` (`invalid-input`, `sealed`,
`parent-not-found`, `too-large`). Bodies are never logged whole, only their
length and first few characters. A mark and its log row are written in the
same transaction.

To query it on the machine (there is deliberately no public page for it):

```sh
flyctl ssh console -a <app> -C "node scripts/audit.ts --actor v-00961c4886"
flyctl ssh console -a <app> -C "node scripts/audit.ts --mark 131 --since 2026-10-12T09:00"
flyctl ssh console -a <app> -C "node scripts/audit.ts --action mark.reply --limit 20 --json"
```

Locally, set `DATA_DIR` to the directory holding `marks.sqlite`.

## Trying it with two browsers

1. Open the app in two separate browser profiles (a private window counts),
   A and B. A third person tails `flyctl logs -a <app>` and doesn't look at
   either screen.
2. A posts a mark. It appears on B's home page within a second, and only A
   sees it badged "yours". The log shows a `mark.post` from A's actor.
3. B opens it and replies. A's page shows "1 reply" without reloading; the
   log shows a `mark.reply` from a second actor, with `parent_actor` naming
   A.
4. B types half a reply and leaves it while A posts again: B's draft stays.
5. B sends a blank reply. The form comes back with the problem marked, and
   the log shows `rejected` / `invalid-input` against B.
6. B tries to reply to a mark in a sealed week by opening one from the
   archive: there's no form, and a crafted POST gets `rejected` / `sealed`.
7. Stop the app (or redeploy) while both pages are open, post from a third
   browser once it's back: both pages catch up on their own.

The narrator can tell the whole story from the log alone: which browser did
what, to which mark, and what was refused and why.

## What's deliberately not here

There is still no way to edit or delete a mark. That was a deliberate choice
at the start, and sealing weeks makes it more important rather than less.

## What I read to get here

- Robin Sloan, [*An App Can Be a Home-Cooked
  Meal*](https://www.robinsloan.com/notes/home-cooked-app/) and its
  [five-year follow-up](https://www.robinsloan.com/lab/five-years-of-home-cooked-apps/)
- Ink & Switch, [*Malleable
  Software*](https://www.inkandswitch.com/essay/malleable-software/)
- the crit-8 pod's prompt for this riff, which asked for the weekly tree and
  for "time is just further left"
- the crit-9 pod's prompt, which asked for live updates, logs a third person
  can narrate from, and an archive that survives its own failures
