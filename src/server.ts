import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { marked } from "marked";
import { getCookie, getVisitorId, setCookie } from "./cookies.ts";
import {
  archiveList,
  crumbs,
  escapeHtml,
  formatTime,
  MAX_BODY,
  MAX_NAME,
  page,
  postForm,
  replyCount,
  wall,
} from "./render.ts";
import { openStore, type MarkWithCount, type Store } from "./db.ts";
import { weekLabel } from "./week.ts";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_REQUEST_BYTES = 8192;

// One SQLite file on the mounted volume: /data survives a restart or a
// redeploy, nothing else does (see fly.toml). DATA_DIR overrides it for a
// local run, where there's no volume.
const dataDir = process.env.DATA_DIR ?? "/data";
mkdirSync(dataDir, { recursive: true });
const store: Store = openStore(`${dataDir}/marks.sqlite`);

// three.js is served from node_modules under a versioned path, so it can be
// cached for good; our own client modules change with deploys, so they can't.
const THREE_VERSION = (JSON.parse(readFileSync("node_modules/three/package.json", "utf8")) as { version: string })
  .version;
const STATIC_ROOTS: [prefix: string, dir: string, cache: string][] = [
  [`/vendor/three@${THREE_VERSION}/addons/`, "node_modules/three/examples/jsm", "public, max-age=31536000, immutable"],
  [`/vendor/three@${THREE_VERSION}/`, "node_modules/three/build", "public, max-age=31536000, immutable"],
  ["/static/", "public", "public, max-age=300"],
];
const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

// `.trim()` only strips whitespace (Unicode `Zs`), not zero-width/format
// characters (`Cf`, e.g. U+200B) — a string made of nothing else survives
// `.trim()` non-empty and reads as blank on the wall.
function hasVisibleContent(s: string): boolean {
  return /[^\s\p{Cf}]/u.test(s);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

function notFound(res: ServerResponse): void {
  sendHtml(
    res,
    404,
    page("Not found", `<main><h1>Nothing here</h1><p>That mark doesn't exist. <a href="/">Back to this week</a>.</p></main>`),
  );
}

function sealedNotice(weekId: number | null): string {
  const week = weekId === null ? undefined : store.getWeek(weekId);
  const label = week ? weekLabel(week.week_start) : "This week";
  return `<p class="notice">${escapeHtml(label)} is archived. It sealed at 00:00 Monday, Sydney time, and nothing can be added to it now. <a href="/">Leave a mark on this week instead</a>.</p>`;
}

function homePage(visitorId: string, lastName: string, now: Date): string {
  const week = store.currentWeek(now);
  const marks = store.children(week.root_mark_id);
  return page(
    "Marks",
    `<header>
  <h1>Marks</h1>
  <p>${escapeHtml(weekLabel(week.week_start))}. Leave a short mark; at 00:00 Monday it's sealed into the <a href="/archive/">archive</a>, for good.</p>
</header>
<main>
${postForm("/", lastName, "Leave it", "Your mark")}
<h2 class="muted">This week</h2>
${wall(marks, visitorId, "No marks yet this week. Be the first.")}
</main>`,
    { nav: "home" },
  );
}

function markPage(mark: MarkWithCount, visitorId: string, lastName: string, now: Date): string {
  const archived = store.isArchived(mark, now);
  const kids = store.children(mark.id);
  const mine = mark.visitor_id === visitorId;
  let heading: string;
  let extra = "";
  if (mark.is_root) {
    heading = `<h1>${escapeHtml(mark.body)}</h1>`;
    const week = mark.week_id === null ? undefined : store.getWeek(mark.week_id);
    const older = week?.prev_week_id ? store.getWeek(week.prev_week_id) : undefined;
    const newer = store.weeks().find((w) => w.prev_week_id === week?.id);
    extra = `<nav class="week-nav" aria-label="Weeks">
  ${older ? `<a href="/m/${older.root_mark_id}">← ${escapeHtml(weekLabel(older.week_start))}</a>` : "<span></span>"}
  ${newer ? `<a href="/m/${newer.root_mark_id}">${escapeHtml(weekLabel(newer.week_start))} →</a>` : ""}
</nav>`;
  } else {
    heading = `<h1>A mark by ${escapeHtml(mark.name)}</h1>
<div class="mark focus-mark${mine ? " mine" : ""}">
  <p class="mark-body">${escapeHtml(mark.body)}</p>
  <p class="mark-meta"><time datetime="${escapeHtml(mark.created_at)}">${formatTime(mark.created_at)}</time>${
    mine ? ' <span class="badge">yours</span>' : ""
  } · ${replyCount(mark.child_count)}</p>
</div>`;
  }
  const title = mark.is_root ? `${mark.body} · Marks` : `${mark.name}: ${mark.body.slice(0, 40)} · Marks`;
  return page(
    title,
    `${crumbs(store.ancestors(mark))}
<main>
${heading}
${extra}
<p><a href="/archive/#m-${mark.id}">Find in archive</a></p>
${archived ? sealedNotice(mark.week_id) : postForm(`/m/${mark.id}`, lastName, "Reply", "Your reply")}
<h2 class="muted">${mark.is_root ? "Marks" : "Replies"}</h2>
${wall(kids, visitorId, archived ? "No replies, and now there never will be." : "No replies yet.")}
</main>`,
  );
}

function archivePage(now: Date): string {
  const current = store.currentWeek(now);
  const byParent = new Map<number, MarkWithCount[]>();
  for (const m of store.allMarks()) {
    if (m.parent_id === null) continue;
    const list = byParent.get(m.parent_id) ?? [];
    list.push(m);
    byParent.set(m.parent_id, list);
  }
  const importMap = JSON.stringify({
    imports: {
      three: `/vendor/three@${THREE_VERSION}/three.module.js`,
      "three/addons/": `/vendor/three@${THREE_VERSION}/addons/`,
    },
  });
  return page(
    "Archive · Marks",
    `<main id="archive">
<h1>Archive</h1>
<p class="muted" id="archive-intro">Every week of marks, newest first. Each week seals at 00:00 Monday, Sydney time.</p>
<section id="list-view" aria-labelledby="list-heading">
<h2 id="list-heading">The whole tree</h2>
${archiveList(store.weeks(), byParent, current.id)}
</section>
</main>`,
    {
      nav: "archive",
      bodyClass: "archive-page",
      head: `<link rel="stylesheet" href="/static/archive.css">
<script type="importmap">${importMap}</script>
<script type="module" src="/static/archive.js"></script>`,
    },
  );
}

// The whole tree in one response, presented as children arrays. A week root's
// parent is the next newer week's root and its leftmost child is the previous
// week's root; childCount counts only real replies. Never includes visitor_id:
// `mine` is worked out here, per request.
function archiveJson(visitorId: string, now: Date): unknown {
  const current = store.currentWeek(now);
  const weeks = store.weeks();
  const newerRoot = new Map<number, number>();
  for (const w of weeks) {
    if (w.prev_week_id === null) continue;
    const prev = weeks.find((p) => p.id === w.prev_week_id);
    if (prev) newerRoot.set(prev.root_mark_id, w.root_mark_id);
  }
  const marks = store.allMarks();
  const children = new Map<number, number[]>();
  for (const w of weeks) {
    const prev = weeks.find((p) => p.id === w.prev_week_id);
    children.set(w.root_mark_id, prev ? [prev.root_mark_id] : []);
  }
  for (const m of marks) {
    if (m.parent_id === null) continue;
    const list = children.get(m.parent_id) ?? [];
    list.push(m.id);
    children.set(m.parent_id, list);
  }
  return {
    currentWeekId: current.id,
    weeks: weeks.map((w) => ({
      id: w.id,
      weekStart: w.week_start,
      label: weekLabel(w.week_start),
      rootMarkId: w.root_mark_id,
      prevWeekId: w.prev_week_id,
      archived: w.id !== current.id,
    })),
    marks: marks.map((m) => ({
      id: m.id,
      parentId: m.is_root ? (newerRoot.get(m.id) ?? null) : m.parent_id,
      weekId: m.week_id,
      isRoot: m.is_root === 1,
      name: m.name,
      body: m.body,
      createdAt: m.created_at,
      childCount: m.child_count,
      children: children.get(m.id) ?? [],
      mine: !m.is_root && m.visitor_id === visitorId,
    })),
  };
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  for (const [prefix, dir, cache] of STATIC_ROOTS) {
    if (!pathname.startsWith(prefix)) continue;
    const base = resolve(dir);
    let rel: string;
    try {
      rel = decodeURIComponent(pathname.slice(prefix.length));
    } catch {
      return false;
    }
    const file = resolve(base, normalize(rel));
    const type = CONTENT_TYPES[extname(file)];
    if (!file.startsWith(base + sep) || !type) return false;
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": type, "Cache-Control": cache });
      res.end(data);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

async function handlePost(
  req: IncomingMessage,
  res: ServerResponse,
  visitorId: string,
  parentId: number | null,
  now: Date,
): Promise<void> {
  const params = new URLSearchParams(await readBody(req));
  const name = (params.get("name") ?? "").trim().slice(0, MAX_NAME);
  const body = (params.get("body") ?? "").trim().slice(0, MAX_BODY);
  const back = parentId === null ? "/" : `/m/${parentId}`;
  if (!hasVisibleContent(name) || !hasVisibleContent(body)) {
    if (parentId !== null && !store.getMark(parentId)) return notFound(res);
    res.writeHead(303, { Location: back });
    res.end();
    return;
  }
  const result = store.post(visitorId, name, body, parentId, now);
  if (!result.ok) {
    if (result.reason === "not-found") return notFound(res);
    const parent = store.getMark(parentId ?? 0);
    sendHtml(
      res,
      403,
      page("Archived · Marks", `<main><h1>That week is sealed</h1>${sealedNotice(parent?.week_id ?? null)}</main>`),
    );
    return;
  }
  setCookie(res, "name", name);
  const current = store.currentWeek(now);
  res.writeHead(303, { Location: result.parentId === current.root_mark_id ? "/" : back });
  res.end();
}

function markId(pathname: string): number | undefined {
  const match = pathname.match(/^\/m\/(\d{1,15})\/?$/);
  return match ? Number(match[1]) : undefined;
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const now = new Date();

      if (req.method === "GET" && (await serveStatic(url.pathname, res))) return;

      const visitorId = getVisitorId(req, res);
      const lastName = getCookie(req, "name") ?? "";

      if (url.pathname === "/") {
        if (req.method === "POST") return await handlePost(req, res, visitorId, null, now);
        if (req.method === "GET") return sendHtml(res, 200, homePage(visitorId, lastName, now));
      }

      if (url.pathname.startsWith("/m/")) {
        const id = markId(url.pathname);
        const mark = id === undefined ? undefined : store.getMark(id);
        if (req.method === "POST" && id !== undefined) return await handlePost(req, res, visitorId, id, now);
        if (req.method === "GET") {
          if (!mark) return notFound(res);
          if (mark.id === store.currentWeek(now).root_mark_id) {
            res.writeHead(302, { Location: "/" });
            res.end();
            return;
          }
          return sendHtml(res, 200, markPage(mark, visitorId, lastName, now));
        }
        return notFound(res);
      }

      if (req.method === "GET" && url.pathname === "/archive/") {
        return sendHtml(res, 200, archivePage(now));
      }
      if (req.method === "GET" && url.pathname === "/archive") {
        res.writeHead(301, { Location: "/archive/" });
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/archive.json") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" });
        res.end(JSON.stringify(archiveJson(visitorId, now)));
        return;
      }

      if (req.method === "GET" && url.pathname === "/readme/") {
        const md = readFileSync("README.md", "utf8");
        const html = await marked.parse(md);
        return sendHtml(res, 200, page("About this app", `<main>${html}</main>`));
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      res.end("something went wrong");
    }
  })();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on :${PORT}`);
});

