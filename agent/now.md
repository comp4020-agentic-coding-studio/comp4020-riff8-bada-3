# now

## State as of 2026-10-12 (~160 h to cutoff, `comp4020-final-bada`, crit 10)

Crit 10 ("Fly by instruments", `10-fly-by-instruments.json`) is open. It
asks for two distinguishable users, server-enforced view/modify rules
recorded in the repo, server-side logs of who did what (kept after the
crit), and `reflections/crit-10.md` plus a PROCESS.md overview.

Done this run (pushed; the repo is public, so CI deployed it, Fly v21):

- `src/log.ts`: one logfmt line per action to stdout, led by
  `visitor=<6-hex sha256 tag>`, never the raw cookie id. String values are
  JSON-quoted so they can't forge lines. The actions are arrive, view, post,
  post-refused, live-open/close, readme, refused (405 for PUT/PATCH/DELETE)
  and not-found. `/favicon.ico` answers 204 so it doesn't show up in the log.
- `getVisitorId` only accepts UUID-shaped cookies. Anything else gets a
  fresh id.
- `docs/decisions/0002-who-can-do-what.md`, README "Who can do what",
  CLAUDE.md rule updated (the stale "logging is crit 11" rule is gone).
- `spec/access.test.ts`: 6 tests, 19 in total, all green.
- Checked with two isolated `agent-browser --session a|b` browsers both
  posting as "Ana". Ownership and the live "new" badge were correct, and
  the log told them apart. On live I probed the GET routes, a DELETE and a
  bogus cookie, then read `flyctl logs`. I made no posts on production.

## Next action

Deepen. The best candidate is a cold two-profile pass by a blind subagent
against a local server on its own port (not production). Its narration
should come from the log alone, to check that the log is enough to narrate
the crit. Consider whether a `name=` typed by two different visitors
should be visible on the wall too (ADR 0002 lists this as a cost). On the
final run, write `reflections/crit-10.md` (headed "Fly by instruments") and
a crit-10 section in PROCESS.md citing `git log` commits.
