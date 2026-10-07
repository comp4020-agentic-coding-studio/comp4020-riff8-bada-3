# This repo is a pod riff: pods write the prompt, the agent does the work

This repo is a copy of [`comp4020-final-bada`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bada) at
`c50d1d0e` --- bada's crit agent's final project as it stood at
`08-its-alive`. Their repo is untouched and off limits. From here to the end of
semester, each crit a pod picks this repo up from wherever the last run left
it.

**Pods: the only file you change is `prompt.md`, at the repo root.** Read the
live app, the code and the history, then write the prompt that would take
this app to a strong, interesting answer to the next brief (the crit runsheet
links it). The prompt can point at any file here. After the session,
bada's crit agent runs `prompt.md` once, unattended, start to finish, and
nobody is there to answer its questions --- so say what you want, what good
looks like and what to leave alone. Push it before you leave.

**Crit agent: when `prompt.md` exists, it is your brief.** Run it to
completion in one go, keep `main` deployable, and delete `prompt.md` in your
last commit. Leave this block of `CLAUDE.md` as it is.

**Nothing here is marked.** No cutoff, no reflection, no `PROCESS.md` entry.
The next crit opens by looking at where each pod repo ended up, beside the
prompt that got it there (the `prompt-crit<N>` tag).

**The agent's own spec tests are `spec/marks.test.ts`.** They encode the brief it was
working to, and they gate the deploy. A prompt aimed at a different brief can
have them changed or deleted; keep `spec/invariants.test.ts` green, since that
one is true of any good site.

Everything below this line was written for the agent's graded submission. Its
marks, cutoff and weekly skills don't govern this repo: read it for how the
agent was directed, not for what anyone owes.

---

# Marks

Rules for working on this app, derived from what README.md argues "good"
means for it. If a change would break one of these, the README needs to
change first --- not the other way around.

- No accounts. Identity is a random id in a first-party cookie, issued on
  first visit. Never add passwords, email, or OAuth --- this app only needs
  to tell two visitors apart, not verify who they are. `visitor_id` never
  leaves the server: `/archive.json` sends a per-request `mine` flag instead.
- Marks are permanent once posted: no edit, no delete. A week is sealed at
  00:00 Monday, Sydney time: nothing can be posted under any mark in a past
  week, and the form isn't rendered there.
- The tree is a parent pointer (`marks.parent_id`); week roots are rows in
  `marks`, chained through `weeks.prev_week_id`. Never store children as an
  array. Rollover is lazy, on request, never a timer (the machine sleeps).
- Week arithmetic goes through `src/week.ts`, which asks `Intl` for Sydney's
  offset. Never hard-code +10/+11.
- Schema changes are additive and run at boot against a populated volume.
  Never drop or rewrite a real mark's name or body.
- Escape every piece of user-submitted text before it reaches HTML
  (`escapeHtml` in `src/render.ts`). On the client, user text goes in via
  `textContent` only, never `innerHTML`.
- Server-rendered HTML is the interface. Home and mark pages work fully with
  JavaScript off. The archive is the one place JS is required, and its
  nested-list fallback (no JS, no WebGL, or "List view") must stay complete.
- One SQLite file on the Fly volume (`node:sqlite`, no native dependency,
  no separate database service) is the only storage. No ORM, no build step.
- Dependencies: `marked` renders README.md at `/readme/`; `three` drives the
  archive and is served from `node_modules` under its version, through the
  import map in `src/server.ts`. Anything else new needs the same
  justification.
- `scripts/seed.ts` is for a scratch `DATA_DIR` only, never `/data`.
