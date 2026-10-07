// The archive's tree model, independent of three.js and the DOM: navigation
// rules, flight paths, layout and announcements. Pure functions over the
// /archive.json payload, so spec/archive-tree.test.ts can check them.
//
// The tree: the current week's root is the top. A week root's children are
// the previous week's root (leftmost) and then that week's marks, oldest
// first; a mark's children are its replies, oldest first. So "left" is always
// "earlier", and stepping left past a week's first mark lands in last week.

/**
 * @typedef {{ id: number, parentId: number | null, weekId: number, isRoot: boolean,
 *   name: string, body: string, createdAt: string, childCount: number,
 *   children: number[], mine: boolean }} ArchiveMark
 * @typedef {{ id: number, weekStart: string, label: string, rootMarkId: number,
 *   prevWeekId: number | null, archived: boolean }} ArchiveWeek
 * @typedef {{ currentWeekId: number, weeks: ArchiveWeek[], marks: ArchiveMark[] }} ArchiveData
 * @typedef {ArchiveMark & { weekIndex: number, depth: number, label: string, archived: boolean }} TreeNode
 * @typedef {{ nodes: Map<number, TreeNode>, rootId: number, weekRoots: number[] }} Tree
 * @typedef {"up" | "down" | "left" | "right" | "older" | "newer" | "home"} Move
 */

/** @param {ArchiveData} data @returns {Tree} */
export function buildTree(data) {
  const weeks = new Map(data.weeks.map((w) => [w.id, w]));
  const current = weeks.get(data.currentWeekId);
  if (!current) throw new Error("archive has no current week");
  // Newest first, following the chain rather than trusting array order.
  const weekRoots = [];
  for (let w = current; w; w = w.prevWeekId === null ? undefined : weeks.get(w.prevWeekId)) {
    weekRoots.push(w.rootMarkId);
  }
  const weekIndex = new Map(data.weeks.map((w) => [w.id, weekRoots.indexOf(w.rootMarkId)]));
  /** @type {Map<number, TreeNode>} */
  const nodes = new Map();
  for (const m of data.marks) {
    const week = weeks.get(m.weekId);
    nodes.set(m.id, {
      ...m,
      weekIndex: weekIndex.get(m.weekId) ?? 0,
      depth: 0,
      label: week?.label ?? "",
      archived: week?.archived ?? true,
    });
  }
  // Depth within the week: 0 for a root, 1 for a top-level mark, and so on.
  for (const node of nodes.values()) {
    let depth = 0;
    let n = node;
    while (!n.isRoot && n.parentId !== null) {
      const parent = nodes.get(n.parentId);
      if (!parent) break;
      depth++;
      n = parent;
    }
    node.depth = depth;
  }
  return { nodes, rootId: current.rootMarkId, weekRoots };
}

/** @param {Tree} tree @param {number} id */
function realChildren(tree, id) {
  return (tree.nodes.get(id)?.children ?? []).filter((c) => !tree.nodes.get(c)?.isRoot);
}

/**
 * Where a key takes you from `id`, or null at an edge.
 * @param {Tree} tree @param {number} id @param {Move} move @returns {number | null}
 */
export function move(tree, id, move) {
  const node = tree.nodes.get(id);
  if (!node) return tree.rootId;
  switch (move) {
    case "up":
      return node.parentId;
    case "down":
      return realChildren(tree, id)[0] ?? null;
    case "left":
    case "right": {
      if (node.parentId === null) return null;
      const siblings = tree.nodes.get(node.parentId)?.children ?? [];
      const at = siblings.indexOf(id) + (move === "left" ? -1 : 1);
      return siblings[at] ?? null;
    }
    case "older":
      return tree.weekRoots[node.weekIndex + 1] ?? null;
    case "newer": {
      // From a mark, "newer" first lands on its own week's root.
      if (!node.isRoot) return tree.weekRoots[node.weekIndex];
      return tree.weekRoots[node.weekIndex - 1] ?? null;
    }
    case "home":
      return id === tree.rootId ? null : tree.rootId;
  }
  return null;
}

/** @param {Tree} tree @param {number} id @returns {number[]} id, its parent, ..., the top */
function lineage(tree, id) {
  const out = [];
  for (let n = tree.nodes.get(id); n; n = n.parentId === null ? undefined : tree.nodes.get(n.parentId)) {
    out.push(n.id);
  }
  return out;
}

/**
 * The walk from a to b along real edges: up to their common ancestor, then
 * down. Both ends included.
 * @param {Tree} tree @param {number} a @param {number} b @returns {number[]}
 */
export function pathBetween(tree, a, b) {
  const up = lineage(tree, a);
  const down = lineage(tree, b);
  const inUp = new Set(up);
  const meet = down.findIndex((id) => inUp.has(id));
  if (meet === -1) return [a, b];
  return [...up.slice(0, up.indexOf(down[meet]) + 1), ...down.slice(0, meet).reverse()];
}

/** @param {string} s @param {number} max */
export function snippet(s, max) {
  const line = s.split(/\r?\n/)[0];
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** @param {number} n */
export function replies(n) {
  return n === 1 ? "1 reply" : `${n} replies`;
}

/** The first real mark of a root's week, for its bubble. @param {Tree} tree @param {number} id */
export function firstMark(tree, id) {
  const first = realChildren(tree, id)[0];
  return first === undefined ? undefined : tree.nodes.get(first);
}

/**
 * What the live region says when a node is selected.
 * @param {Tree} tree @param {number} id @returns {string}
 */
export function describe(tree, id) {
  const n = tree.nodes.get(id);
  if (!n) return "";
  if (n.isRoot) {
    const state = id === tree.rootId ? "this week" : "sealed";
    const count = n.childCount === 1 ? "1 mark" : `${n.childCount} marks`;
    return `${n.label}, ${state}, ${count}. Down arrow to read it, Enter to open.`;
  }
  return `${n.label}, mark by ${n.name}: “${snippet(n.body, 90)}”, ${replies(n.childCount)}, Enter to open.`;
}

/** Why a key did nothing. @param {Tree} tree @param {number} id @param {Move} move */
export function edgeMessage(tree, id, move) {
  const n = tree.nodes.get(id);
  switch (move) {
    case "up":
      return "This is the top of the tree: this week.";
    case "down":
      return n?.isRoot ? "Nobody left a mark this week." : "No replies to this mark.";
    case "left":
      return n?.isRoot && id !== tree.rootId
        ? "Already leftmost. Press [ for the week before this one."
        : "Nothing further left.";
    case "right":
      return "Nothing further right.";
    case "older":
      return "This is the oldest week.";
    case "newer":
      return "This is the newest week.";
    case "home":
      return "Already at this week.";
  }
  return "";
}

// Layout constants, in scene units. Each older week steps left, down and
// back into the fog; a week's marks fan out to the right and down.
export const WEEK_STEP = { x: -7, y: -4.5, z: -24 };
const LEVEL = { y: -2.7, z: 1.1 };
const LEAF_WIDTH = 2.8;
const FIRST_X = 2.6;

/**
 * Positions for every node, plus each node's growth time (distance from the
 * top in edges, a spine step counting a bit more than a reply).
 * @param {Tree} tree
 * @returns {Map<number, { x: number, y: number, z: number, grow: number }>}
 */
export function layout(tree) {
  /** @type {Map<number, { x: number, y: number, z: number, grow: number }>} */
  const out = new Map();
  /** @type {Map<number, number>} */
  const leaves = new Map();
  /** @param {number} id @returns {number} */
  const countLeaves = (id) => {
    const kids = realChildren(tree, id);
    const n = kids.length === 0 ? 1 : kids.reduce((sum, k) => sum + countLeaves(k), 0);
    leaves.set(id, n);
    return n;
  };
  tree.weekRoots.forEach((rootId, k) => {
    const root = {
      x: k * WEEK_STEP.x,
      y: k * WEEK_STEP.y,
      z: k * WEEK_STEP.z,
      grow: k * 1.6,
    };
    out.set(rootId, root);
    /** @param {number} id @param {number} depth @param {number} start @param {number} grow */
    const place = (id, depth, start, grow) => {
      const span = leaves.get(id) ?? countLeaves(id);
      out.set(id, {
        x: root.x + FIRST_X + (start + span / 2 - 0.5) * LEAF_WIDTH,
        y: root.y + depth * LEVEL.y,
        z: root.z + depth * LEVEL.z,
        grow,
      });
      let cursor = start;
      for (const kid of realChildren(tree, id)) {
        place(kid, depth + 1, cursor, grow + 1);
        cursor += leaves.get(kid) ?? 1;
      }
    };
    let cursor = 0;
    for (const kid of realChildren(tree, rootId)) {
      countLeaves(kid);
      place(kid, 1, cursor, root.grow + 1);
      cursor += leaves.get(kid) ?? 1;
    }
  });
  return out;
}
