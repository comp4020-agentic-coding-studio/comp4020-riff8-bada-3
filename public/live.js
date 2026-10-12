// Live updates for every page: one EventSource on /events, patching the
// server-rendered HTML in place. It never touches a form, so a draft, focus
// and caret survive whatever arrives; new marks slot in by id, so a replayed
// or duplicate event changes nothing. The archive page adds its own handlers
// (archive.js) for the tree; the list and counts are patched here, so they
// stay live whether or not the 3D scene ever starts.
//
// Reconnects: the browser retries a dropped stream itself and sends
// Last-Event-ID, so the server replays what was missed. If a reconnect gets a
// non-stream answer (a proxy's 502 while the machine restarts), EventSource
// gives up for good; this reopens it with backoff from the newest id seen.

const timeFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  dateStyle: "medium",
  timeStyle: "short",
});

/** @param {number} n */
export const replyCount = (n) => (n === 1 ? "1 reply" : `${n} replies`);
/** @param {number} n */
const markCount = (n) => (n === 1 ? "1 mark" : `${n} marks`);

/** @param {string} s @param {number} max */
function snippet(s, max) {
  const chars = [...s.split(/\r?\n/)[0]];
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
}

/** @param {string} tag @param {Record<string, string>} [attrs] @param {string} [text] */
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @typedef {{ id: number, parentId: number, weekId: number, name: string, body: string,
 *   createdAt: string, childCount: number, parentChildCount: number, mine: boolean }} MarkEvent
 * @typedef {{ id: number, weekStart: string, label: string, rootMarkId: number,
 *   prevWeekId: number | null, prevRootMarkId: number | null }} WeekEvent
 */

/** @param {number} id @param {number} n */
function setCount(id, n) {
  for (const node of document.querySelectorAll(`[data-count-for="${id}"]`)) {
    const text = /** @type {HTMLElement} */ (node).dataset.countFormat === "marks" ? markCount(n) : replyCount(n);
    if (node.textContent !== text) node.textContent = text;
    const tail = /** @type {HTMLElement} */ (node).dataset.label;
    if (tail) node.setAttribute("aria-label", `${replyCount(n)} ${tail}`);
  }
}

/** @param {MarkEvent} m @param {boolean} archived */
function wallItem(m, archived) {
  const li = el("li", { class: `mark is-new${m.mine ? " mine" : ""}`, "data-id": String(m.id) });
  li.append(el("p", { class: "mark-body" }, m.body));
  const meta = el("p", { class: "mark-meta" });
  meta.append(el("span", { class: "mark-name" }, m.name), " · ");
  meta.append(el("time", { datetime: m.createdAt }, timeFormat.format(new Date(m.createdAt))));
  if (m.mine) meta.append(" ", el("span", { class: "badge" }, "yours"));
  const tail = `on ${m.name}'s mark “${snippet(m.body, 40)}”, open to ${archived ? "read" : "read and reply"}`;
  meta.append(
    " · ",
    el(
      "a",
      { href: `/m/${m.id}`, "data-count-for": String(m.id), "data-label": tail, "aria-label": `${replyCount(m.childCount)} ${tail}` },
      replyCount(m.childCount),
    ),
  );
  li.append(meta);
  return li;
}

/** Walls are newest first. @param {MarkEvent} m @returns {boolean} whether it was new here */
function addToWall(m) {
  const wall = /** @type {HTMLElement | null} */ (document.querySelector(`[data-wall="${m.parentId}"]`));
  const list = wall?.querySelector("ol.marks");
  if (!wall || !list || list.querySelector(`:scope > li[data-id="${m.id}"]`)) return false;
  const before = [...list.children].find((li) => Number(/** @type {HTMLElement} */ (li).dataset.id) < m.id);
  list.insertBefore(wallItem(m, wall.dataset.archived === "1"), before ?? null);
  wall.querySelector(".empty")?.setAttribute("hidden", "");
  return true;
}

/** The archive's nested list is oldest first. @param {MarkEvent} m */
function addToList(m) {
  const listView = document.getElementById("list-view");
  const parent = listView?.querySelector(`#m-${m.parentId}`);
  if (!listView || !parent || document.getElementById(`m-${m.id}`)) return;
  let ul = parent.querySelector(":scope > ul");
  if (!ul) ul = parent.appendChild(el("ul"));
  const li = el("li", { id: `m-${m.id}` });
  li.append(el("a", { href: `/m/${m.id}` }, `${m.name}: ${snippet(m.body, 80)}`), " ");
  li.append(el("span", { class: "muted", "data-count-for": String(m.id) }, replyCount(m.childCount)));
  const after = [...ul.children].find((x) => Number(x.id.slice(2)) > m.id);
  ul.insertBefore(li, after ?? null);
  parent.querySelector(":scope > .empty")?.setAttribute("hidden", "");
}

/** @param {WeekEvent} w */
function addWeekToList(w) {
  const listView = document.getElementById("list-view");
  if (!listView || document.getElementById(`m-${w.rootMarkId}`)) return;
  for (const state of listView.querySelectorAll(".week-state")) state.textContent = " · sealed";
  const details = el("details", { id: `m-${w.rootMarkId}`, "data-week": String(w.id) });
  details.open = true;
  const summary = el("summary");
  const muted = el("span", { class: "muted" });
  muted.append(
    el("span", { "data-count-for": String(w.rootMarkId), "data-count-format": "marks" }, "0 marks"),
    el("span", { class: "week-state" }, " · this week"),
  );
  summary.append(el("a", { href: `/m/${w.rootMarkId}` }, w.label), " ", muted);
  details.append(summary, el("p", { class: "empty" }, "Nobody left a mark this week."), el("ul"));
  listView.querySelector("h2")?.after(details);
}

/**
 * @param {{ onMark?: (m: MarkEvent) => void, onWeek?: (w: WeekEvent) => void }} [handlers]
 */
export function startLive(handlers = {}) {
  const main = /** @type {HTMLElement | null} */ (document.querySelector("[data-after]"));
  if (!main || typeof EventSource === "undefined") return;
  const cfg = main.dataset;
  const status = /** @type {HTMLElement | null} */ (main.querySelector(".live-status"));
  let lastId = Number(cfg.after);
  /** @type {EventSource | null} */
  let source = null;
  let backoff = 1000;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let retryTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let rolloverTimer;
  let latest = "";

  /** @param {"live" | "connecting" | "down"} state @param {string} text */
  function setStatus(state, text) {
    if (!status) return;
    status.hidden = false;
    status.dataset.state = state;
    if (status.textContent !== text) status.textContent = text;
  }

  /** @param {MessageEvent} e */
  function seen(e) {
    const id = Number(e.lastEventId);
    if (Number.isFinite(id) && id > lastId) lastId = id;
  }

  /** @param {MarkEvent} m */
  function onMark(m) {
    setCount(m.parentId, m.parentChildCount);
    setCount(m.id, m.childCount);
    if (addToWall(m)) {
      latest = m.mine ? "Your mark is up." : `Latest: ${m.name} just posted.`;
      setStatus("live", `Live. ${latest}`);
    }
    addToList(m);
    handlers.onMark?.(m);
  }

  // A newer week: the room's page moves on; pages under the old week seal.
  /** @param {WeekEvent} w */
  function onWeek(w) {
    const newer = !cfg.weekStart || w.weekStart > cfg.weekStart;
    if (newer) {
      const oldLabel = document.getElementById("week-label")?.textContent ?? "Last week";
      cfg.weekStart = w.weekStart;
      if (cfg.page === "home") moveHomeOn(w, oldLabel);
      if (cfg.page === "mark" && cfg.archived !== "1" && cfg.week !== String(w.id)) seal(cfg.weekLabel ?? oldLabel);
      addWeekToList(w);
    }
    handlers.onWeek?.(w);
  }

  /** @param {WeekEvent} w @param {string} oldLabel */
  function moveHomeOn(w, oldLabel) {
    cfg.week = String(w.id);
    cfg.root = String(w.rootMarkId);
    const label = document.getElementById("week-label");
    if (label) label.textContent = w.label;
    const wall = /** @type {HTMLElement | null} */ (document.querySelector("[data-wall]"));
    if (wall) {
      wall.dataset.wall = String(w.rootMarkId);
      wall.querySelector("ol.marks")?.replaceChildren();
      wall.querySelector(".empty")?.removeAttribute("hidden");
    }
    const notice = el("p", { class: "notice" });
    notice.append(
      `${oldLabel} sealed at 00:00 Monday and is now in the `,
      el("a", { href: "/archive/" }, "archive"),
      ". This page has moved on to the new week; anything you were writing is still in the form.",
    );
    main.querySelector("form")?.before(notice);
  }

  /** @param {string} label */
  function seal(label) {
    cfg.archived = "1";
    const form = main.querySelector("form");
    if (!form) return;
    const notice = el("p", { class: "notice sealed-notice" });
    notice.append(
      `${label} sealed at 00:00 Monday, so a reply here will be refused. Your draft is still here: you can post it as a new mark on this week instead.`,
    );
    form.before(notice);
    const reply = form.querySelector('button[type="submit"]');
    if (reply) {
      reply.setAttribute("disabled", "");
      reply.after(" ", el("button", { type: "submit", formaction: "/" }, "Post it on this week instead"));
    }
  }

  /** @param {{ now: string, sealsAt: string }} hello */
  function scheduleRollover(hello) {
    clearTimeout(rolloverTimer);
    // Server time, not this device's, and a little after midnight: the
    // reconnect is the request that lazily creates the new week.
    const wait = Date.parse(hello.sealsAt) - Date.parse(hello.now) + 1000 + Math.random() * 2000;
    rolloverTimer = setTimeout(reopen, Math.min(Math.max(wait, 1000), 2 ** 31 - 1));
  }

  function connect() {
    clearTimeout(retryTimer);
    const es = new EventSource(`/events?after=${lastId}`);
    source = es;
    es.addEventListener("open", () => {
      backoff = 1000;
      setStatus("live", latest ? `Live. ${latest}` : "Live: new marks appear here as they're posted.");
    });
    es.addEventListener("hello", (e) => scheduleRollover(JSON.parse(e.data)));
    es.addEventListener("mark", (e) => {
      seen(e);
      onMark(JSON.parse(e.data));
    });
    es.addEventListener("week", (e) => {
      seen(e);
      onWeek(JSON.parse(e.data));
    });
    es.addEventListener("resync", () => {
      es.close();
      setStatus("down", "A lot changed while this page was away. Refresh to catch up.");
    });
    es.addEventListener("error", () => {
      if (es !== source) return;
      if (es.readyState === EventSource.CLOSED) {
        setStatus("down", `Can't reach the server. Trying again in ${Math.round(backoff / 1000)} s; refresh any time.`);
        retryTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      } else {
        setStatus("connecting", "Reconnecting…");
      }
    });
  }

  function reopen() {
    source?.close();
    connect();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && source?.readyState === EventSource.CLOSED) reopen();
  });
  window.addEventListener("online", () => {
    if (source?.readyState !== EventSource.OPEN) reopen();
  });

  setStatus("connecting", "Connecting…");
  connect();
  return { lastId: () => lastId };
}
