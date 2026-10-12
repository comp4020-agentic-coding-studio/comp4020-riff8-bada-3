// Turns /archive/ into the 3D tree when it can, and leaves the server-rendered
// nested list (the no-JS and screen-reader view) in place when it can't. Keys,
// the D-pad, the preview card, announcements and deep links live here; the
// scene itself is archive-scene.js, loaded only once WebGL is known to work.
//
// The list stays visible and usable until the scene has actually started.
// Live data (live.js) runs first and never depends on the scene: the list and
// its counts update in any mode, and the tree is rebuilt from the same events
// whether it's showing, paused in list mode, or not running at all.
import {
  applyMark,
  applyWeek,
  buildTree,
  describe,
  edgeMessage,
  move,
  replies,
  tooBigForScene,
} from "./archive-tree.js";
import { startLive } from "./live.js";

/** @typedef {import("./archive-tree.js").Move} Move */
/** @typedef {import("./archive-tree.js").Tree} Tree */
/** @typedef {import("./archive-tree.js").ArchiveData} ArchiveData */
/** @typedef {ReturnType<typeof import("./archive-scene.js").startScene>} Scene */

const KEYS = /** @type {Record<string, Move | "open">} */ ({
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Escape: "up",
  "[": "older",
  PageDown: "older",
  "]": "newer",
  PageUp: "newer",
  Home: "home",
  Enter: "open",
});

const timeFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  dateStyle: "medium",
  timeStyle: "short",
});

/** @param {string} tag @param {Record<string, string>} attrs @param {string} [text] */
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** @param {Tree} tree */
function initialId(tree) {
  const fromHash = location.hash.match(/^#m-(\d+)$/);
  const fromQuery = new URLSearchParams(location.search).get("at");
  const id = Number(fromHash?.[1] ?? fromQuery ?? NaN);
  return tree.nodes.has(id) ? id : tree.rootId;
}

function main() {
  const archive = document.getElementById("archive");
  const list = document.getElementById("list-view");
  if (!archive || !list) return;
  const body = document.body;

  // ---- data, live from the start ------------------------------------------------
  /** @type {ArchiveData | null} */
  let data = null;
  /** @type {(() => void)[]} */
  const pending = [];
  let rebuildQueued = false;

  /** @param {() => boolean} apply */
  function onData(apply) {
    if (!data) {
      pending.push(() => void apply());
      return;
    }
    if (apply() && !rebuildQueued) {
      // A burst of events rebuilds the tree once.
      rebuildQueued = true;
      setTimeout(() => {
        rebuildQueued = false;
        rebuild();
      }, 120);
    }
  }

  startLive({
    onMark: (m) => onData(() => applyMark(/** @type {ArchiveData} */ (data), m)),
    onWeek: (w) => onData(() => applyWeek(/** @type {ArchiveData} */ (data), w)),
  });

  // ---- notes ---------------------------------------------------------------------
  /** @param {string} why */
  function note(why) {
    const text = `${why} Here's the whole tree as a list instead.`;
    const existing = document.querySelector(".fallback-note");
    if (existing) existing.textContent = text;
    else list?.before(el("p", { class: "notice fallback-note" }, text));
  }
  const clearNote = () => document.querySelector(".fallback-note")?.remove();

  if (!webglAvailable()) {
    note("This browser isn't offering WebGL, so the 3D archive can't run.");
    return;
  }

  // ---- chrome: stage, toggle, preview, D-pad, legend, live region -------------
  const stage = el("div", {
    id: "stage",
    class: "stage",
    tabindex: "0",
    role: "application",
    "aria-label": "Archive tree. Arrow keys move, Enter opens. The list view has the same tree as text.",
  });
  const loading = el("p", { class: "scene-loading-note", role: "status" }, "Growing the 3D tree… the list works meanwhile.");
  const hud = el("div", { class: "hud" });
  const toggle = el("button", { type: "button", class: "view-toggle", "aria-pressed": "false" }, "List view");
  const announce = el("p", { class: "sr-only", "aria-live": "polite" });
  const hudMsg = el("p", { class: "hud-msg", "aria-hidden": "true" });

  const preview = el("section", { class: "preview", "aria-label": "Selected mark" });
  const pWho = el("p", { class: "preview-who" });
  const pBody = el("p", { class: "preview-body" });
  const pMeta = el("p", { class: "preview-meta" });
  const pOpen = el("a", { class: "preview-open", href: "/" }, "Open");
  preview.append(pWho, pBody, pMeta, pOpen);

  const controls = el("div", { class: "controls" });
  const weeknav = el("div", { class: "weeknav", role: "group", "aria-label": "Move between weeks" });
  const dpad = el("div", { class: "dpad", role: "group", "aria-label": "Move through the tree" });
  /** @type {Map<Move, HTMLButtonElement>} */
  const padButtons = new Map();
  /** @type {[Move, string, string, HTMLElement][]} */
  const pads = [
    ["older", "‹ Older week", "Older week", weeknav],
    ["newer", "Newer week ›", "Newer week", weeknav],
    ["up", "↑", "Parent", dpad],
    ["left", "←", "Earlier sibling", dpad],
    ["home", "⌂", "This week", dpad],
    ["right", "→", "Later sibling", dpad],
    ["down", "↓", "First reply", dpad],
  ];
  for (const [m, text, label, group] of pads) {
    const attrs = { type: "button", class: `pad pad-${m}` };
    const b = /** @type {HTMLButtonElement} */ (
      el("button", text === label ? attrs : { ...attrs, "aria-label": label, title: label }, text)
    );
    b.addEventListener("click", () => go(m));
    padButtons.set(m, b);
    group.append(b);
  }
  controls.append(hudMsg, weeknav, dpad);

  const legend = el("details", { class: "legend" });
  legend.append(el("summary", {}, "Keys"));
  const dl = el("dl");
  for (const [k, v] of [
    ["↑ / Esc", "parent (from a week: the newer week)"],
    ["↓", "first reply"],
    ["← →", "siblings; left of a week's first mark is last week"],
    ["[ ]", "older / newer week (or the buttons)"],
    ["Enter", "open"],
    ["Home", "back to this week"],
  ]) {
    dl.append(el("dt", {}, k), el("dd", {}, v));
  }
  legend.append(dl);
  if (window.matchMedia("(min-width: 641px)").matches) legend.open = true;
  hud.append(legend, preview, controls);

  // ---- state ---------------------------------------------------------------------
  /** @type {Tree | null} */
  let tree = null;
  /** @type {Scene | null} */
  let scene = null;
  /** @type {typeof import("./archive-scene.js") | null} */
  let sceneModule = null;
  let selected = 0;
  /** @type {number | null} */
  let hovered = null;
  let treeMode = false;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  function showPreview() {
    if (!tree) return;
    const id = hovered ?? selected;
    const n = tree.nodes.get(id);
    if (!n) return;
    if (n.isRoot) {
      pWho.textContent = n.body;
      pBody.textContent =
        id === tree.rootId
          ? "This week. Everything posted on the home page hangs here until 00:00 Monday."
          : "A sealed week. Nothing can be added to it now.";
      pMeta.textContent = n.childCount === 1 ? "1 mark" : `${n.childCount} marks`;
    } else {
      pWho.textContent = n.mine ? `${n.name} (yours)` : n.name;
      pBody.textContent = n.body;
      pMeta.textContent = `${timeFormat.format(new Date(n.createdAt))} · ${replies(n.childCount)}`;
    }
    pOpen.href = id === tree.rootId ? "/" : `/m/${id}`;
    pOpen.textContent = n.isRoot ? `Open ${n.body}` : `Open ${n.name}'s mark`;
    preview.classList.toggle("is-hover", hovered !== null && hovered !== selected);
  }

  // Buttons at an edge stay pressable (they say why nothing happens) but
  // read as unavailable.
  function updatePads() {
    if (!tree) return;
    for (const [m, b] of padButtons) {
      const blocked = move(tree, selected, m) === null;
      b.setAttribute("aria-disabled", String(blocked));
    }
  }

  /** @param {number} id */
  function select(id) {
    if (!tree) return;
    selected = id;
    hovered = null;
    scene?.select(id);
    showPreview();
    updatePads();
    hudMsg.textContent = "";
    announce.textContent = describe(tree, id);
    // Track position in the URL without a history entry per keypress.
    history.replaceState(null, "", `#m-${id}`);
  }

  /** @param {number} id */
  function open(id) {
    location.href = id === tree?.rootId ? "/" : `/m/${id}`;
  }

  let msgTimer = 0;
  /** @param {Move} m */
  function go(m) {
    if (!tree) return;
    const next = move(tree, selected, m);
    if (next === null) {
      const why = edgeMessage(tree, selected, m);
      // Re-set even if unchanged, so a repeated edge still gets announced.
      announce.textContent = "";
      requestAnimationFrame(() => (announce.textContent = why));
      hudMsg.textContent = why;
      clearTimeout(msgTimer);
      msgTimer = window.setTimeout(() => (hudMsg.textContent = ""), 3500);
      stage.classList.remove("bump");
      void stage.offsetWidth;
      stage.classList.add("bump");
      return;
    }
    select(next);
  }

  // ---- modes ---------------------------------------------------------------------
  function enterTree() {
    treeMode = true;
    body.classList.remove("scene-preparing");
    body.classList.add("scene-on");
    toggle.setAttribute("aria-pressed", "false");
    toggle.textContent = "List view";
    scene?.resume();
  }

  function enterList() {
    treeMode = false;
    body.classList.remove("scene-on", "scene-preparing");
    scene?.pause();
    toggle.setAttribute("aria-pressed", "true");
    toggle.textContent = "Tree view";
    // Land the list on the same mark the tree was showing.
    const item = document.getElementById(`m-${selected}`);
    for (let d = item?.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
    // after the layout switch, or the scroll lands against the old layout
    requestAnimationFrame(() => item?.scrollIntoView({ block: "center" }));
  }

  // Back to the list for good (until the toggle tries again), with a reason.
  /** @param {string} why @param {boolean} [retry] whether the toggle may try again */
  function fallBack(why, retry = false) {
    scene?.dispose();
    scene = null;
    loading.remove();
    body.classList.remove("scene-on", "scene-preparing");
    treeMode = false;
    if (retry) {
      toggle.setAttribute("aria-pressed", "true");
      toggle.textContent = "Try the tree view again";
    } else {
      toggle.remove();
      hud.remove();
      stage.remove();
    }
    note(why);
  }

  // The stage gets a real, full-viewport size while hidden ("preparing"), so
  // the renderer and camera start from true dimensions, never 0×0.
  function startTree() {
    if (!tree || !sceneModule) return;
    const big = tooBigForScene(tree);
    if (big) return fallBack(big);
    body.classList.add("scene-preparing");
    try {
      scene = sceneModule.startScene({
        tree,
        container: stage,
        initialId: selected,
        reducedMotion: reduce.matches,
        onSelect: (id) => select(id),
        onHover: (id) => {
          hovered = id;
          showPreview();
        },
        onOpen: (id) => open(id),
        onContextLost: () => fallBack("The 3D view lost its graphics context.", true),
      });
    } catch (err) {
      console.error(err);
      scene = null;
      return fallBack("The 3D archive couldn't start.");
    }
    loading.remove();
    clearNote();
    enterTree();
    showPreview();
    updatePads();
    announce.textContent = describe(tree, selected);
  }

  function rebuild() {
    if (!data) return;
    try {
      tree = buildTree(data);
    } catch (err) {
      console.error(err);
      return;
    }
    if (!tree.nodes.has(selected)) selected = tree.rootId;
    const big = tooBigForScene(tree);
    if (big && scene) return fallBack(big);
    scene?.update(tree);
    showPreview();
    updatePads();
  }

  // ---- events --------------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (!treeMode || !scene) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // Only when nothing else has focus: nav links, the preview's Open link and
    // the D-pad buttons keep their own keys.
    if (e.target !== document.body && e.target !== stage) return;
    const action = KEYS[e.key];
    if (!action) return;
    e.preventDefault();
    if (action === "open") open(selected);
    else go(action);
  });

  window.addEventListener("hashchange", () => {
    if (!tree) return;
    const id = initialId(tree);
    if (id !== selected) select(id);
  });

  // Into the tree, focus follows to the stage, so the arrow keys work at once.
  toggle.addEventListener("click", () => {
    if (treeMode) return enterList();
    if (scene) enterTree();
    else startTree();
    if (treeMode) stage.focus({ preventScroll: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) scene?.pause();
    else if (treeMode) scene?.resume();
  });
  reduce.addEventListener("change", () => scene?.setReducedMotion(reduce.matches));

  // A hook for checks and curious devtools users; holds no private data.
  Object.assign(window, {
    __archive: {
      stats: () => scene?.stats() ?? null,
      selected: () => selected,
      mode: () => (treeMode ? "tree" : "list"),
      nodes: () => tree?.nodes.size ?? 0,
    },
  });

  // ---- start ---------------------------------------------------------------------
  list.before(toggle);
  // Inside <main>, so every control sits in a landmark; the HUD is fixed-position.
  archive.append(hud, announce);
  archive.after(stage);
  document.getElementById("archive-intro")?.after(loading);
  body.classList.add("scene-preparing");

  (async () => {
    try {
      const res = await fetch("/archive.json");
      if (!res.ok) throw new Error(`archive.json: ${res.status}`);
      data = /** @type {ArchiveData} */ (await res.json());
      tree = buildTree(data);
    } catch (err) {
      console.error(err);
      return fallBack("The archive's data couldn't load.");
    }
    for (const apply of pending.splice(0)) apply();
    tree = buildTree(data);
    selected = initialId(tree);
    try {
      sceneModule = await import("./archive-scene.js");
    } catch (err) {
      console.error(err);
      return fallBack("The 3D view's code couldn't load.");
    }
    startTree();
  })();
}

main();
