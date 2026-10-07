// Turns /archive/ into the 3D tree when it can, and leaves the server-rendered
// nested list (the no-JS and screen-reader view) in place when it can't. Keys,
// the D-pad, the preview card, announcements and deep links live here; the
// scene itself is archive-scene.js, loaded only once WebGL is known to work.
import { buildTree, describe, edgeMessage, move, replies } from "./archive-tree.js";

/** @typedef {import("./archive-tree.js").Move} Move */

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

/** @param {string} why */
function fallback(why) {
  document.body.classList.remove("scene-on", "scene-loading");
  const list = document.getElementById("list-view");
  if (!list || document.querySelector(".fallback-note")) return;
  list.before(el("p", { class: "notice fallback-note" }, `${why} Here's the whole tree as a list instead.`));
}

function initialId(tree) {
  const fromHash = location.hash.match(/^#m-(\d+)$/);
  const fromQuery = new URLSearchParams(location.search).get("at");
  const id = Number(fromHash?.[1] ?? fromQuery ?? NaN);
  return tree.nodes.has(id) ? id : tree.rootId;
}

async function main() {
  const archive = document.getElementById("archive");
  const list = document.getElementById("list-view");
  if (!archive || !list) return;

  if (!webglAvailable()) {
    fallback("This browser isn't offering WebGL, so the 3D archive can't run.");
    return;
  }
  document.body.classList.add("scene-on", "scene-loading");

  let tree;
  let sceneModule;
  try {
    const [res, mod] = await Promise.all([fetch("/archive.json"), import("./archive-scene.js")]);
    if (!res.ok) throw new Error(`archive.json: ${res.status}`);
    tree = buildTree(await res.json());
    sceneModule = mod;
  } catch {
    fallback("The 3D archive couldn't load.");
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
  const hud = el("div", { class: "hud" });
  const toggle = el("button", { type: "button", class: "view-toggle", "aria-pressed": "false" }, "List view");
  const announce = el("p", { class: "sr-only", "aria-live": "polite" });

  const preview = el("section", { class: "preview", "aria-label": "Selected mark" });
  const pWho = el("p", { class: "preview-who" });
  const pBody = el("p", { class: "preview-body" });
  const pMeta = el("p", { class: "preview-meta" });
  const pOpen = el("a", { class: "preview-open", href: "/" }, "Open");
  preview.append(pWho, pBody, pMeta, pOpen);

  const dpad = el("div", { class: "dpad", role: "group", "aria-label": "Move through the tree" });
  /** @type {[Move, string, string][]} */
  const pads = [
    ["up", "↑", "Parent"],
    ["left", "←", "Earlier sibling"],
    ["home", "⌂", "This week"],
    ["right", "→", "Later sibling"],
    ["down", "↓", "First reply"],
  ];
  for (const [m, glyph, label] of pads) {
    const b = el("button", { type: "button", class: `pad pad-${m}`, "aria-label": label, title: label }, glyph);
    b.addEventListener("click", () => go(m));
    dpad.append(b);
  }

  const legend = el("details", { class: "legend" });
  legend.append(el("summary", {}, "Keys"));
  const dl = el("dl");
  for (const [k, v] of [
    ["↑ / Esc", "parent (from a week: the newer week)"],
    ["↓", "first reply"],
    ["← →", "siblings; left of a week's first mark is last week"],
    ["[ ]", "older / newer week"],
    ["Enter", "open"],
    ["Home", "back to this week"],
  ]) {
    dl.append(el("dt", {}, k), el("dd", {}, v));
  }
  legend.append(dl);
  if (window.matchMedia("(min-width: 641px)").matches) legend.open = true;

  hud.append(legend, preview, dpad);
  list.before(toggle);
  // Inside <main>, so every control sits in a landmark; the HUD is fixed-position.
  archive.append(hud, announce);
  archive.after(stage);

  // ---- state ---------------------------------------------------------------------
  let selected = initialId(tree);
  /** @type {number | null} */
  let hovered = null;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  function showPreview() {
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

  const scene = sceneModule.startScene({
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
  });
  document.body.classList.remove("scene-loading");
  reduce.addEventListener("change", () => scene.setReducedMotion(reduce.matches));
  // A hook for checks and curious devtools users; holds no private data.
  Object.assign(window, { __archive: { stats: scene.stats, selected: () => selected } });

  /** @param {number} id */
  function select(id) {
    selected = id;
    hovered = null;
    scene.select(id);
    showPreview();
    announce.textContent = describe(tree, id);
    // Track position in the URL without a history entry per keypress.
    history.replaceState(null, "", `#m-${id}`);
  }

  /** @param {number} id */
  function open(id) {
    location.href = id === tree.rootId ? "/" : `/m/${id}`;
  }

  /** @param {Move} m */
  function go(m) {
    const next = move(tree, selected, m);
    if (next === null) {
      // Re-set even if unchanged, so a repeated edge still gets announced.
      announce.textContent = "";
      requestAnimationFrame(() => (announce.textContent = edgeMessage(tree, selected, m)));
      stage.classList.remove("bump");
      void stage.offsetWidth;
      stage.classList.add("bump");
      return;
    }
    select(next);
  }

  document.addEventListener("keydown", (e) => {
    if (!document.body.classList.contains("scene-on")) return;
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
    const id = initialId(tree);
    if (id !== selected) select(id);
  });

  toggle.addEventListener("click", () => {
    const listOn = document.body.classList.toggle("scene-on") === false;
    toggle.setAttribute("aria-pressed", String(listOn));
    toggle.textContent = listOn ? "Tree view" : "List view";
    if (listOn) {
      // Land the list on the same mark the tree was showing.
      const item = document.getElementById(`m-${selected}`);
      for (let d = item?.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
      item?.scrollIntoView({ block: "center" });
    }
  });

  showPreview();
  announce.textContent = describe(tree, selected);
}

main();
