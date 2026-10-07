#!/usr/bin/env node
// Local only: fills a scratch DATA_DIR with ~7 backdated weeks of marks and
// replies (some 4--5 deep) so the archive has a tree to fly through. It posts
// through the real store with an injected clock, so every week is created,
// chained and sealed exactly as the live app would have done it.
//
//   DATA_DIR=./data node scripts/seed.ts
//
// Refuses to touch /data, which is where the Fly volume is mounted.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openStore } from "../src/db.ts";

const dataDir = process.env.DATA_DIR;
if (!dataDir || resolve(dataDir) === "/data") {
  console.error("set DATA_DIR to a scratch directory (never /data): DATA_DIR=./data node scripts/seed.ts");
  process.exit(1);
}
mkdirSync(dataDir, { recursive: true });
const store = openStore(`${dataDir}/marks.sqlite`);

// A small deterministic PRNG, so two seeds of the same directory look alike.
let state = 4020;
const rand = (): number => {
  state = (state * 1664525 + 1013904223) % 2 ** 32;
  return state / 2 ** 32;
};
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

const NAMES = ["Ana", "Bo", "Cyrus", "Dee", "Eun-ji", "Farah", "Gus", "Hemi", "Ines", "Jun", "Kalani", "Lior"];
const OPENERS = [
  "The deploy finally went green at 2am and I have never been happier to see a checkmark.",
  "Is anyone else's Fly machine taking forever to wake up on the first request?",
  "Crit today was brutal but fair. The pod spotted the bug in about ninety seconds.",
  "Hot take: the README is the most important file in the repo.",
  "I asked the agent to write tests first and it wrote them last. Again.",
  "Found a zero-width space in someone's name field. We live in a society.",
  "Who left the coffee machine on in the lab? It's still warm.",
  "Reading Robin Sloan on home-cooked apps and feeling seen.",
  "My SQLite file is 40 KB and I am weirdly proud of it.",
  "Does anyone have a good link on server-sent events vs websockets?",
  "Shipping something small that works beats planning something big that doesn't.",
  "The lighthouse score dropped to 98 and I took it personally.",
  "Tried the arrow keys on someone's game and it scrolled the page instead. Classic.",
  "Remember to push before the cutoff, friends.",
  "Our pod named the prototype after a fish. No regrets.",
  "First mark of the week! The wall is ours.",
];
const REPLIES = [
  "Same here.",
  "Hard agree.",
  "Can you say more about that?",
  "This happened to me too, the fix was clearing my cookies.",
  "I'd argue the opposite, honestly.",
  "Ha! Classic.",
  "Link please?",
  "Was it the cold start? Try hitting it twice.",
  "Respectfully: no.",
  "This is the content I come here for.",
  "Did you write that down in your PROCESS.md?",
  "Going to try that tonight.",
  "Plus one. Also, who brought the biscuits?",
  "The pod is going to argue for the option you didn't pick.",
  "Okay but what did the tests say?",
];

function reply(parentId: number, depth: number, at: Date): void {
  const res = store.post("seed", pick(NAMES), pick(REPLIES), parentId, at);
  if (!res.ok) throw new Error(`seed reply failed: ${res.reason}`);
  // Each level is less likely to go deeper, but some threads run 4--5 levels.
  if (depth < 5 && rand() < 0.62 - depth * 0.08) {
    const n = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) reply(res.id, depth + 1, new Date(at.getTime() + 60_000 * (i + 1)));
  }
}

const WEEKS = 7;
const now = Date.now();
const DAY = 86_400_000;
let marks = 0;
for (let w = WEEKS; w >= 0; w--) {
  // Wednesday-ish of the week w weeks ago; skip one week to show the chain
  // jumping a week nobody visited.
  if (w === 3) continue;
  const base = now - w * 7 * DAY;
  const weekStart = store.currentWeek(new Date(base)).week_start;
  const count = w === 0 ? 3 : 3 + Math.floor(rand() * 4);
  for (let i = 0; i < count; i++) {
    // keep every post inside the same Sydney week as `base`
    const at = new Date(base - 2 * 3_600_000 + i * 600_000);
    if (store.currentWeek(at).week_start !== weekStart) continue;
    const res = store.post("seed", pick(NAMES), pick(OPENERS), null, at);
    if (!res.ok) throw new Error(`seed post failed: ${res.reason}`);
    marks++;
    if (rand() < 0.75) reply(res.id, 1, new Date(at.getTime() + 300_000));
  }
}

console.log(`seeded ${store.weeks().length} weeks, ${store.allMarks().length} rows (${marks} top-level marks) into ${dataDir}`);
store.close();
