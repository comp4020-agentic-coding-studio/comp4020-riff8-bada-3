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
before, because in this tree the past is just further left. Without either
of those it's the same tree as nested lists, one expandable section per week.
That's also the view screen readers get.

This is the one place the app asks for JavaScript, and it's the one place it
takes on a real dependency: three.js, served straight from the app's own
`node_modules` without a CDN or a build step. Posting, replying and reading a
mark all work with scripts off.

## What's deliberately not here yet

Real-time updates and server-side logging both belong to later crits. There
is still no way to edit or delete a mark. That was a deliberate choice at the
start, and sealing weeks makes it more important rather than less.

## What I read to get here

- Robin Sloan, [*An App Can Be a Home-Cooked
  Meal*](https://www.robinsloan.com/notes/home-cooked-app/) and its
  [five-year follow-up](https://www.robinsloan.com/lab/five-years-of-home-cooked-apps/)
- Ink & Switch, [*Malleable
  Software*](https://www.inkandswitch.com/essay/malleable-software/)
- the crit-8 pod's prompt for this riff, which asked for the weekly tree and
  for "time is just further left"
