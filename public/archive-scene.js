// The archive as a living tree you travel through. Rendering, animation and
// pointer input only: what the keys mean, what gets announced and what the
// preview shows live in archive.js and archive-tree.js.
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { firstMark, layout, pathBetween, snippet, WEEK_STEP } from "./archive-tree.js";

/** @typedef {import("./archive-tree.js").Tree} Tree */

const BACKGROUND = 0x060a14;
const COLOURS = {
  // Bubbles sit just past 1 so the bloom pass catches them; edges sit below
  // its threshold, so they stay lines rather than floodlights.
  root: new THREE.Color(1.25, 0.88, 0.38), // gold
  current: new THREE.Color(1.4, 1.0, 0.42),
  mark: new THREE.Color(0.35, 1.0, 1.25), // teal
  mine: new THREE.Color(1.35, 0.45, 1.05), // rose: marks you left
  spine: new THREE.Color(0.62, 0.44, 0.2),
  branch: new THREE.Color(0.2, 0.5, 0.62),
  pulse: new THREE.Color(2.6, 2.3, 1.6),
};
// From the left and a little above: from here, "back into the fog" reads as
// "further left", so the spine visibly steps left into the past.
const CAMERA_OFFSET = new THREE.Vector3(-5, 4, 15);
// Frame a little right of and below the selection, where its replies grow.
const LOOK_AHEAD = new THREE.Vector3(2.2, -1.4, 0);
const GROW_STEP = 0.32; // seconds per edge of distance from the top
const BLOOM_TIME = 0.55;
const LABEL_NEAR = 20;
const LABEL_FAR = 34;

/** A soft round glow, drawn once, for particles, halos and the pulse. */
function glowTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/** The curve of the edge from parent to child, bowed like a branch. */
function edgeCurve(from, to, spine) {
  const a = new THREE.Vector3(from.x, from.y, from.z);
  const b = new THREE.Vector3(to.x, to.y, to.z);
  if (spine) {
    return new THREE.CubicBezierCurve3(
      a,
      a.clone().add(new THREE.Vector3(WEEK_STEP.x * 0.1, WEEK_STEP.y * 0.6, WEEK_STEP.z * 0.35)),
      b.clone().add(new THREE.Vector3(-WEEK_STEP.x * 0.35, -WEEK_STEP.y * 0.1, -WEEK_STEP.z * 0.35)),
      b,
    );
  }
  return new THREE.CubicBezierCurve3(
    a,
    a.clone().add(new THREE.Vector3((b.x - a.x) * 0.15, (b.y - a.y) * 0.75, 0)),
    b.clone().add(new THREE.Vector3(0, (a.y - b.y) * 0.55, (a.z - b.z) * 0.3)),
    b,
  );
}

/**
 * The scene's whole lifecycle: built once per WebGL context, fed new trees
 * with update(), paused when nobody can see it, disposed when it's done or the
 * context is lost. If anything throws while it's being built, whatever was
 * made is released before the error reaches the caller.
 *
 * @param {{
 *   tree: Tree,
 *   container: HTMLElement,
 *   initialId: number,
 *   reducedMotion: boolean,
 *   onSelect: (id: number) => void,
 *   onHover: (id: number | null) => void,
 *   onOpen: (id: number) => void,
 *   onContextLost?: () => void,
 * }} opts
 */
export function startScene(opts) {
  /** @type {(() => void)[]} */
  const cleanup = [];
  try {
    return buildScene(opts, cleanup);
  } catch (err) {
    for (const fn of cleanup.reverse()) {
      try {
        fn();
      } catch {
        // already half gone
      }
    }
    throw err;
  }
}

/** @param {Parameters<typeof startScene>[0]} opts @param {(() => void)[]} cleanup */
function buildScene(
  { tree: initialTree, container, initialId, reducedMotion, onSelect, onHover, onOpen, onContextLost },
  cleanup,
) {
  const events = new AbortController();
  cleanup.push(() => events.abort());
  const { signal } = events;
  const glow = glowTexture();
  cleanup.push(() => glow.dispose());

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  cleanup.push(() => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(BACKGROUND);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.className = "scene-canvas";
  container.append(renderer.domElement);
  renderer.domElement.addEventListener(
    "webglcontextlost",
    (e) => {
      e.preventDefault();
      pause();
      onContextLost?.();
    },
    { signal },
  );

  const labels = new CSS2DRenderer();
  labels.domElement.className = "scene-labels";
  labels.domElement.setAttribute("aria-hidden", "true");
  container.append(labels.domElement);
  cleanup.push(() => labels.domElement.remove());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.fog = new THREE.FogExp2(BACKGROUND, 0.026);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  cleanup.push(() => controls.dispose());
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.minDistance = 4;
  controls.maxDistance = 38;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.9;
  controls.minAzimuthAngle = -1.0;
  controls.maxAzimuthAngle = 1.0;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  cleanup.push(() => {
    bloom.dispose();
    composer.dispose();
  });

  // Everything that sways moves together, so edges stay attached to bubbles.
  const treeGroup = new THREE.Group();
  scene.add(treeGroup);
  const sphere = new THREE.SphereGeometry(1, 24, 16);
  cleanup.push(() => sphere.dispose());

  /** @param {THREE.Object3D} obj */
  const release = (obj) => {
    const o = /** @type {THREE.Mesh} */ (obj);
    if (o.geometry && o.geometry !== sphere) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) m.dispose();
  };

  // ---- the tree: edges and bubbles, rebuilt whenever the data changes --------
  let tree = initialTree;
  /** @type {Map<number, { x: number, y: number, z: number, grow: number }>} */
  let positions = new Map();
  /** @type {Map<number, { curve: THREE.CubicBezierCurve3, mesh: THREE.Mesh, start: number, end: number, samples: THREE.Vector3[], opacity: number }>} */
  let edges = new Map(); // keyed by child id
  /** @type {Map<number, { mesh: THREE.Mesh, halo: THREE.Sprite, label: CSS2DObject, el: HTMLElement, base: number, born: number, phase: number }>} */
  let bubbles = new Map();
  /** @type {THREE.Mesh[]} */
  let pickable = [];
  let spineLength = 1;

  function clearTree() {
    for (const child of [...treeGroup.children]) {
      if (child === ring || child === pulse) continue;
      treeGroup.remove(child); // a CSS2DObject takes its element with it
      release(child);
    }
    edges = new Map();
    bubbles = new Map();
    pickable = [];
  }

  /**
   * @param {Set<number>} [known] ids already on screen: they appear fully
   *   grown, and only what's new grows in. Without it, the whole tree grows.
   */
  function buildTree(known) {
    positions = layout(tree);
    const now = age();
    /** @param {number} id @param {number} grow */
    const bornAt = (id, grow) => (!known ? grow * GROW_STEP : known.has(id) ? -1e6 : now);

    for (const node of tree.nodes.values()) {
      if (node.parentId === null) continue;
      const from = positions.get(node.parentId);
      const to = positions.get(node.id);
      if (!from || !to) continue;
      const spine = node.isRoot;
      const curve = edgeCurve(from, to, spine);
      const geometry = new THREE.TubeGeometry(curve, spine ? 48 : 20, spine ? 0.11 : 0.035, spine ? 8 : 5, false);
      // One material per edge, so an edge that swings close to the camera can
      // fade on its own instead of flaring across the screen.
      const opacity = spine ? 1 : 0.85;
      const material = new THREE.MeshBasicMaterial({
        color: spine ? COLOURS.spine : COLOURS.branch,
        toneMapped: false,
        transparent: true,
        opacity,
      });
      const mesh = new THREE.Mesh(geometry, material);
      treeGroup.add(mesh);
      const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map((u) => curve.getPoint(u));
      const fresh = known && !known.has(node.id);
      const start = fresh ? now : bornAt(node.parentId, from.grow);
      const end = fresh ? now + 0.35 : bornAt(node.id, to.grow);
      edges.set(node.id, { curve, mesh, start, end, samples, opacity });
    }

    for (const node of tree.nodes.values()) {
      const p = positions.get(node.id);
      if (!p) continue;
      const isCurrent = node.id === tree.rootId;
      const colour = isCurrent ? COLOURS.current : node.isRoot ? COLOURS.root : node.mine ? COLOURS.mine : COLOURS.mark;
      const base = isCurrent ? 0.44 : node.isRoot ? 0.38 : 0.22;
      const mesh = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: colour, toneMapped: false }));
      mesh.position.set(p.x, p.y, p.z);
      mesh.userData.id = node.id;
      treeGroup.add(mesh);
      pickable.push(mesh);

      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow,
          color: colour,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      halo.position.copy(mesh.position);
      treeGroup.add(halo);

      // Bubble text is real DOM, filled with textContent only.
      const el = document.createElement("div");
      el.className = `bubble${node.isRoot ? " bubble-root" : ""}${node.mine ? " bubble-mine" : ""}`;
      const who = document.createElement("span");
      who.className = "bubble-who";
      const what = document.createElement("span");
      what.className = "bubble-what";
      if (node.isRoot) {
        who.textContent = isCurrent ? `${node.body} · now` : node.body;
        const first = firstMark(tree, node.id);
        what.textContent = first ? `${first.name}: ${snippet(first.body, 48)}` : "No marks this week";
      } else {
        who.textContent = node.name;
        what.textContent = snippet(node.body, 56);
      }
      el.append(who, what);
      el.classList.toggle("is-selected", node.id === selected);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        pick(node.id);
      });
      el.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse") onHover(node.id);
      });
      el.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse") onHover(null);
      });
      const label = new CSS2DObject(el);
      label.position.set(p.x, p.y - base - 0.25, p.z);
      label.center.set(0.5, 0);
      treeGroup.add(label);

      bubbles.set(node.id, {
        mesh,
        halo,
        label,
        el,
        base,
        born: bornAt(node.id, p.grow),
        phase: Math.random() * Math.PI * 2,
      });
    }
    spineLength = Math.max(1, tree.weekRoots.length - 1 + 1.5);
  }

  // ---- selection marker and the pulse ----------------------------------------
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.045, 8, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: false }),
  );
  treeGroup.add(ring);
  cleanup.push(() => release(ring));
  const pulse = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glow,
      color: COLOURS.pulse,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  pulse.scale.setScalar(1.6);
  pulse.visible = false;
  treeGroup.add(pulse);
  cleanup.push(() => release(pulse));

  // ---- particles drifting down the spine ---------------------------------------
  const PARTICLES = 700;
  const particleGeometry = new THREE.BufferGeometry();
  const particlePos = new Float32Array(PARTICLES * 3);
  const particleT = new Float32Array(PARTICLES);
  const spread = new Float32Array(PARTICLES * 3);
  for (let i = 0; i < PARTICLES; i++) {
    particleT[i] = Math.random();
    spread[i * 3] = (Math.random() - 0.3) * 30;
    spread[i * 3 + 1] = (Math.random() - 0.5) * 14;
    spread[i * 3 + 2] = (Math.random() - 0.5) * 18;
  }
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePos, 3));
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      map: glow,
      size: 0.32,
      color: new THREE.Color(1.1, 0.95, 0.7),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  scene.add(particles);
  cleanup.push(() => release(particles));

  // ---- camera, selection and flight ----------------------------------------------
  let selected = initialId;
  /** @type {{ path: THREE.CurvePath<THREE.Vector3>, start: number, duration: number, offset: THREE.Vector3, to: number } | null} */
  let flight = null;
  let motion = !reducedMotion;
  const timer = new THREE.Timer();
  let startedAt = motion ? 0 : -1e6; // with reduced motion, everything is already grown
  const age = () => timer.getElapsed() - startedAt;

  const worldOf = (id) => {
    const b = bubbles.get(id);
    return b ? b.mesh.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
  };
  // Where the camera centres for a node: the node, nudged toward its replies.
  const focusOf = (id) => worldOf(id).add(LOOK_AHEAD);

  /** A curve along the real edges from a to b: up to the common ancestor, then down. */
  function flightPath(a, b) {
    const ids = pathBetween(tree, a, b);
    const path = new THREE.CurvePath();
    for (let i = 0; i < ids.length - 1; i++) {
      const [x, y] = [ids[i], ids[i + 1]];
      const goingUp = tree.nodes.get(x)?.parentId === y;
      const edge = edges.get(goingUp ? x : y);
      if (!edge) continue;
      const c = edge.curve;
      path.add(goingUp ? new THREE.CubicBezierCurve3(c.v3, c.v2, c.v1, c.v0) : c);
    }
    return path;
  }

  function placeCamera(id) {
    const target = focusOf(id);
    controls.target.copy(target);
    camera.position.copy(target).add(CAMERA_OFFSET);
    controls.update();
  }

  /** Centre on a node at once, keeping the current viewing angle. @param {number} id @param {THREE.Vector3} [offset] */
  function land(id, offset) {
    const keep = offset ?? camera.position.clone().sub(controls.target);
    const target = focusOf(id);
    controls.target.copy(target);
    camera.position.copy(target).add(keep);
  }

  /** @param {number} id */
  function select(id) {
    if (!bubbles.has(id)) return;
    const from = selected;
    selected = id;
    for (const [bid, b] of bubbles) b.el.classList.toggle("is-selected", bid === id);
    if (!motion || from === id) {
      flight = null;
      pulse.visible = false;
      land(id);
      if (!motion) {
        container.classList.remove("cut");
        void container.offsetWidth;
        container.classList.add("cut");
      }
      return;
    }
    const path = flightPath(from, id);
    if (path.curves.length === 0) {
      flight = null;
      land(id);
      return;
    }
    const length = path.getLength();
    flight = {
      path,
      start: timer.getElapsed(),
      duration: Math.min(2.6, 0.55 + length * 0.045),
      offset: camera.position.clone().sub(controls.target).clampLength(6, 20),
      to: id,
    };
    pulse.visible = true;
  }

  // Click/tap a bubble to fly there; again (or its preview's Open) to open it.
  function pick(id) {
    if (id === selected) onOpen(id);
    else onSelect(id);
  }

  // Raycast clicks on the canvas, ignoring drags (which orbit).
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = { x: 0, y: 0 };
  const hit = (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    // Spheres are small; test against a generous proxy radius.
    let best = null;
    let bestDist = Infinity;
    for (const mesh of pickable) {
      const centre = mesh.getWorldPosition(new THREE.Vector3());
      const d = raycaster.ray.distanceSqToPoint(centre);
      const r = mesh.scale.x * 1.8 + 0.2;
      const along = centre.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction);
      if (d < r * r && along > 0 && along < bestDist) {
        best = mesh.userData.id;
        bestDist = along;
      }
    }
    return best;
  };
  const canvas = renderer.domElement;
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      down = { x: e.clientX, y: e.clientY };
    },
    { signal },
  );
  canvas.addEventListener(
    "pointerup",
    (e) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const id = hit(e);
      if (id !== null) pick(id);
    },
    { signal },
  );
  let hoverFrame = 0;
  let hovered = null;
  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse" || e.buttons !== 0 || hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        const id = hit(e);
        if (id !== hovered) {
          hovered = id;
          canvas.style.cursor = id === null ? "" : "pointer";
          onHover(id);
        }
      });
    },
    { signal },
  );
  cleanup.push(() => cancelAnimationFrame(hoverFrame));

  // Don't let a pan carry the view away from the tree.
  controls.addEventListener("change", () => {
    if (flight) return;
    const anchor = focusOf(selected);
    const drift = controls.target.clone().sub(anchor);
    if (drift.length() > 10) {
      drift.setLength(10);
      const delta = anchor.clone().add(drift).sub(controls.target);
      controls.target.add(delta);
      camera.position.add(delta);
    }
  });

  // A hidden stage measures 0×0; that's never a real size, so it's ignored
  // and the last good one kept.
  const size = { w: 0, h: 0 };
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return false;
    if (w === size.w && h === size.h) return true;
    size.w = w;
    size.h = h;
    camera.aspect = w / h;
    // Pull back on narrow screens so a week's fan still fits.
    camera.fov = w < 640 ? 64 : 52;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    labels.setSize(w, h);
    return true;
  }
  const observer = new ResizeObserver(() => resize());
  observer.observe(container);
  cleanup.push(() => observer.disconnect());
  if (!resize()) throw new Error("the archive stage has no size to render into");

  buildTree();
  cleanup.push(() => clearTree());
  placeCamera(initialId);

  // ---- the frame -------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  let frames = 0;
  function frame() {
    timer.update();
    const t = timer.getElapsed();
    const now = t - startedAt;
    frames++;

    // Growth: each edge extends between its parent's and child's time.
    const eye = treeGroup.worldToLocal(camera.position.clone());
    for (const edge of edges.values()) {
      let nearest = Infinity;
      for (const p of edge.samples) nearest = Math.min(nearest, p.distanceToSquared(eye));
      /** @type {THREE.MeshBasicMaterial} */ (edge.mesh.material).opacity =
        edge.opacity * clamp01((Math.sqrt(nearest) - 4) / 8);
      const progress = clamp01((now - edge.start) / Math.max(0.01, edge.end - edge.start));
      const index = edge.mesh.geometry.index;
      const count = index ? index.count : 0;
      edge.mesh.geometry.setDrawRange(0, Math.floor((count * progress) / 6) * 6);
      edge.mesh.visible = progress > 0;
    }

    // Sway: the whole tree breathes a little.
    if (motion) {
      treeGroup.rotation.y = Math.sin(t * 0.21) * 0.025;
      treeGroup.rotation.z = Math.sin(t * 0.17 + 1) * 0.012;
    } else {
      treeGroup.rotation.set(0, 0, 0);
    }

    const selNode = tree.nodes.get(selected);
    for (const [id, b] of bubbles) {
      const bloomT = clamp01((now - b.born) / BLOOM_TIME);
      const s = bloomT === 0 ? 0.0001 : b.base * (bloomT < 1 ? easeOutBack(bloomT) : 1);
      const breathe = motion ? 1 + Math.sin(t * 1.6 + b.phase) * 0.06 : 1;
      b.mesh.scale.setScalar(s * breathe);
      b.halo.scale.setScalar(s * (id === selected ? 5 : 3.2) * breathe);
      b.mesh.visible = bloomT > 0;
      b.halo.visible = bloomT > 0;

      // Labels fade with distance, and only once their bubble has bloomed.
      b.label.getWorldPosition(tmp);
      const d = tmp.distanceTo(camera.position);
      const near = clamp01((LABEL_FAR - d) / (LABEL_FAR - LABEL_NEAR));
      // Weeks newer than where you are sit in the foreground; keep them quiet.
      const node = tree.nodes.get(id);
      const ahead = node && selNode && node.weekIndex < selNode.weekIndex ? 0.3 : 1;
      const opacity = id === selected ? 1 : near * bloomT * ahead;
      b.label.visible = opacity > 0.02;
      if (b.label.visible) b.el.style.opacity = opacity.toFixed(2);
    }

    // The selection ring faces the camera and slowly turns.
    const sel = bubbles.get(selected);
    if (sel) {
      ring.position.copy(sel.mesh.position);
      ring.quaternion.copy(camera.quaternion);
      ring.scale.setScalar(sel.base * 1.9 * (motion ? 1 + Math.sin(t * 3) * 0.05 : 1));
    }

    // Flight along the edges, with a pulse of light running ahead.
    if (flight) {
      const u = clamp01((t - flight.start) / flight.duration);
      const e = easeInOut(u);
      const local = flight.path.getPointAt(e);
      const world = treeGroup.localToWorld(local.clone()).add(LOOK_AHEAD);
      controls.target.copy(world);
      camera.position.copy(world).add(flight.offset);
      pulse.position.copy(flight.path.getPointAt(Math.min(1, e + 0.12 + (1 - e) * 0.1)));
      pulse.material.opacity = 1 - u * u;
      if (u >= 1) {
        flight = null;
        pulse.visible = false;
      }
    } else if (motion) {
      // Follow the selected bubble as the tree sways.
      const target = focusOf(selected);
      const delta = target.clone().sub(controls.target).multiplyScalar(0.08);
      if (delta.lengthSq() < 4) {
        controls.target.add(delta);
        camera.position.add(delta);
      }
    }

    // Particles drift down the spine into the past.
    particles.visible = motion;
    if (motion) {
      const arr = particleGeometry.attributes.position.array;
      for (let i = 0; i < PARTICLES; i++) {
        particleT[i] = (particleT[i] + 0.0006) % 1;
        const k = particleT[i] * spineLength - 0.5;
        arr[i * 3] = k * WEEK_STEP.x + spread[i * 3];
        arr[i * 3 + 1] = k * WEEK_STEP.y + spread[i * 3 + 1] + Math.sin(t * 0.5 + i) * 0.3;
        arr[i * 3 + 2] = k * WEEK_STEP.z + spread[i * 3 + 2];
      }
      particleGeometry.attributes.position.needsUpdate = true;
    }

    controls.update();
    composer.render();
    labels.render(scene, camera);
  }

  // ---- lifecycle -------------------------------------------------------------------
  let running = false;
  let disposed = false;
  let waiting = 0;

  function pause() {
    running = false;
    cancelAnimationFrame(waiting);
    waiting = 0;
    renderer.setAnimationLoop(null);
  }

  // Only start drawing once the stage has a real size again.
  function resume() {
    if (disposed || running) return;
    cancelAnimationFrame(waiting);
    if (!resize()) {
      waiting = requestAnimationFrame(() => {
        waiting = 0;
        resume();
      });
      return;
    }
    running = true;
    timer.reset();
    renderer.setAnimationLoop(frame);
  }
  cleanup.push(() => pause());

  resume();

  return {
    select,
    /** New data: rebuild in place, growing only what's new. @param {Tree} next */
    update(next) {
      if (disposed) return;
      const known = new Set(bubbles.keys());
      const offset = flight ? flight.offset : camera.position.clone().sub(controls.target);
      const to = flight?.to;
      flight = null;
      pulse.visible = false;
      clearTree();
      tree = next;
      if (!tree.nodes.has(selected)) selected = tree.rootId;
      if (to !== undefined && tree.nodes.has(to)) selected = to;
      buildTree(known);
      land(selected, offset);
    },
    pause,
    resume,
    dispose() {
      if (disposed) return;
      disposed = true;
      pause();
      for (const fn of cleanup.reverse()) {
        try {
          fn();
        } catch {
          // keep releasing the rest
        }
      }
      cleanup.length = 0;
    },
    /** @param {boolean} reduced */
    setReducedMotion(reduced) {
      motion = !reduced;
      if (reduced) {
        startedAt = -1e6;
        // Finish any flight where it was going, at once, measured against the
        // still tree the next frames will draw.
        treeGroup.rotation.set(0, 0, 0);
        treeGroup.updateMatrixWorld(true);
        if (flight) land(flight.to, flight.offset);
        flight = null;
        pulse.visible = false;
      }
    },
    /** For checks: what the scene holds, whether it's drawing, and how much it has drawn. */
    stats: () => ({
      nodes: bubbles.size,
      edges: edges.size,
      flying: flight !== null,
      selected,
      running,
      frames,
      size: { ...size },
      target: controls.target.toArray().map((v) => Number(v.toFixed(2))),
      focus: focusOf(selected).toArray().map((v) => Number(v.toFixed(2))),
    }),
  };
}
