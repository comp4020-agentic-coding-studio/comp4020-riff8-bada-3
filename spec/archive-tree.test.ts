import { expect, it } from "vitest";
import { buildTree, describe, edgeMessage, layout, move, pathBetween } from "../public/archive-tree.js";

// The archive's keyboard rules, on a small hand-built tree (no server, no DOM):
//
//   W3 (current, root 30) ─┬─ W2 (root 20) ─┬─ W1 (root 10) ── 11
//                          ├─ 31 ── 33       ├─ 21 ── 23 ── 24
//                          └─ 32             └─ 22
const mark = (id: number, parentId: number | null, weekId: number, children: number[], isRoot = false) => ({
  id,
  parentId,
  weekId,
  isRoot,
  name: isRoot ? "Marks" : `n${id}`,
  body: isRoot ? `Week ${weekId}` : `body ${id}`,
  createdAt: "2026-10-07T00:00:00.000Z",
  childCount: children.filter((c) => c % 10 !== 0).length,
  children,
  mine: false,
});
const tree = buildTree({
  currentWeekId: 3,
  weeks: [
    { id: 3, weekStart: "2026-10-05", label: "Week 3", rootMarkId: 30, prevWeekId: 2, archived: false },
    { id: 1, weekStart: "2026-09-21", label: "Week 1", rootMarkId: 10, prevWeekId: null, archived: true },
    { id: 2, weekStart: "2026-09-28", label: "Week 2", rootMarkId: 20, prevWeekId: 1, archived: true },
  ],
  marks: [
    mark(30, null, 3, [20, 31, 32], true),
    mark(31, 30, 3, [33]),
    mark(32, 30, 3, []),
    mark(33, 31, 3, []),
    mark(20, 30, 2, [10, 21, 22], true),
    mark(21, 20, 2, [23]),
    mark(22, 20, 2, []),
    mark(23, 21, 2, [24]),
    mark(24, 23, 2, []),
    mark(10, 20, 1, [11], true),
    mark(11, 10, 1, []),
  ],
});

it("follows the week chain newest first, whatever the array order", () => {
  expect(tree.rootId).toBe(30);
  expect(tree.weekRoots).toEqual([30, 20, 10]);
});

it("↑ goes to the parent, and from a week root to the newer week", () => {
  expect(move(tree, 33, "up")).toBe(31);
  expect(move(tree, 31, "up")).toBe(30);
  expect(move(tree, 20, "up")).toBe(30);
  expect(move(tree, 10, "up")).toBe(20);
  expect(move(tree, 30, "up")).toBeNull();
});

it("↓ goes to the first real mark, never the previous-week edge", () => {
  expect(move(tree, 30, "down")).toBe(31);
  expect(move(tree, 20, "down")).toBe(21);
  expect(move(tree, 10, "down")).toBe(11);
  expect(move(tree, 32, "down")).toBeNull();
});

it("← past a week's first mark steps into last week", () => {
  expect(move(tree, 32, "left")).toBe(31);
  expect(move(tree, 31, "left")).toBe(20);
  expect(move(tree, 20, "left")).toBeNull();
  expect(move(tree, 20, "right")).toBe(31);
  expect(move(tree, 32, "right")).toBeNull();
  expect(move(tree, 33, "left")).toBeNull();
  expect(move(tree, 30, "left")).toBeNull();
});

it("[ and ] jump between week roots", () => {
  expect(move(tree, 30, "older")).toBe(20);
  expect(move(tree, 23, "older")).toBe(10);
  expect(move(tree, 10, "older")).toBeNull();
  expect(move(tree, 10, "newer")).toBe(20);
  expect(move(tree, 24, "newer")).toBe(20);
  expect(move(tree, 30, "newer")).toBeNull();
  expect(move(tree, 24, "home")).toBe(30);
  expect(move(tree, 30, "home")).toBeNull();
});

it("flies up to the common ancestor and back down", () => {
  expect(pathBetween(tree, 33, 32)).toEqual([33, 31, 30, 32]);
  expect(pathBetween(tree, 24, 11)).toEqual([24, 23, 21, 20, 10, 11]);
  expect(pathBetween(tree, 30, 24)).toEqual([30, 20, 21, 23, 24]);
  expect(pathBetween(tree, 22, 22)).toEqual([22]);
});

it("announces the selection and explains the edges", () => {
  expect(describe(tree, 23)).toBe("Week 2, mark by n23: “body 23”, 1 reply, Enter to open.");
  expect(describe(tree, 30)).toBe("Week 3, this week, 2 marks. Down arrow to read it, Enter to open.");
  expect(edgeMessage(tree, 30, "up")).toMatch(/top/);
  expect(edgeMessage(tree, 20, "left")).toMatch(/\[/);
});

it("lays older weeks out to the left, below and behind", () => {
  const p = layout(tree);
  const [w3, w2, w1] = [p.get(30)!, p.get(20)!, p.get(10)!];
  expect(w2.x).toBeLessThan(w3.x);
  expect(w1.y).toBeLessThan(w2.y);
  expect(w1.z).toBeLessThan(w2.z);
  // a week's marks branch to the right of its root, in sibling order
  expect(p.get(31)!.x).toBeGreaterThan(w3.x);
  expect(p.get(32)!.x).toBeGreaterThan(p.get(31)!.x);
  expect(p.size).toBe(11);
});
