import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { marked } from "marked";
import { cookieHeader, getCookie, getVisitorId } from "./cookies.ts";
import { openStore, type Mark, type MarkWithCount, type PostResult, type Store } from "./db.ts";
import { createLive, type Live } from "./live.ts";
import { actorOf, createLogger, newRequestId, requestContext, type LogLine, type Logger } from "./log.ts";
import {
  archiveList,
  crumbs,
  escapeHtml,
  formatTime,
  liveStatus,
  page,
  postForm,
  replyCount,
  wall,
} from "./render.ts";
import { preview, validateDraft, type Draft, type FieldErrors } from "./validate.ts";
import { weekLabel } from "./week.ts";

export const MAX_REQUEST_BYTES = 8192;

export interface AppOptions {
  dataDir: string;
  // Production reads the real clock; tests pass a fake one. There is
  // deliberately no request parameter that can move it.
  clock?: () => Date;
  // Where log lines go (stdout by default).
  out?: (line: string) => void;
}

export interface App {
  server: Server;
  store: Store;
  live: Live;
  logger: Logger;
  close: () => Promise<void>;
}

class TooLarge extends Error {}

// three.js is served from node_modules under its version, and our client
// modules under a hash of their contents, so both can be cached for good and a
// deploy can never mix old and new modules in one page.
const THREE_VERSION = (JSON.parse(readFileSync("node_modules/three/package.json", "utf8")) as { version: string })
  .version;
const PUBLIC_HASH = (() => {
  const hash = createHash("sha256");
  for (const file of readdirSync("public").sort()) hash.update(file).update(readFileSync(join("public", file)));
  return hash.digest("hex").slice(0, 10);
})();
const STATIC = `/static/${PUBLIC_HASH}/`;
const IMMUTABLE = "public, max-age=31536000, immutable";
const STATIC_ROOTS: [prefix: string, dir: string][] = [
  [`/vendor/three@${THREE_VERSION}/addons/`, "node_modules/three/examples/jsm"],
  [`/vendor/three@${THREE_VERSION}/`, "node_modules/three/build"],
  [STATIC, "public"],
];
const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const PAGE_SCRIPT = `<script type="module" src="${STATIC}page.js"></script>`;

async function readBody(req: IncomingMessage): Promise<string> {
  if (Number(req.headers["content-length"] ?? 0) > MAX_REQUEST_BYTES) throw new TooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new TooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

function redirect(res: ServerResponse, status: number, location: string): void {
  res.writeHead(status, { Location: location });
  res.end();
}

function markId(pathname: string): number | undefined {
  const match = pathname.match(/^\/m\/(\d{1,15})\/?$/);
  return match ? Number(match[1]) : undefined;
}

export function createApp(opts: AppOptions): App {
  const clock = opts.clock ?? (() => new Date());
  mkdirSync(opts.dataDir, { recursive: true });

  // The store needs to tell the live feed about lazily created weeks, and the
  // live feed reads the store: bind late.
  let onWeek: (markId: number) => void = () => {};
  const store: Store = openStore(join(opts.dataDir, "marks.sqlite"), {
    onWeekCreated: (week) => {
      logger.log({ action: "week.rollover", mark: week.root_mark_id, week: week.id, label: weekLabel(week.week_start) });
      onWeek(week.root_mark_id);
    },
  });
  const logger = createLogger(store, clock, opts.out);
  const live = createLive(store, clock);
  onWeek = (id) => live.publish(id);

  function sealedNotice(weekId: number | null): string {
    const week = weekId === null ? undefined : store.getWeek(weekId);
    const label = week ? weekLabel(week.week_start) : "This week";
    return `<p class="notice sealed-notice">${escapeHtml(label)} is archived. It sealed at 00:00 Monday, Sydney time, and nothing can be added to it now. <a href="/">Leave a mark on this week instead</a>.</p>`;
  }

  // What every live page tells page.js: where the feed should pick up from.
  function liveAttrs(attrs: Record<string, string | number>): string {
    const current = store.currentWeek(clock());
    const all = { after: store.lastMarkId(), "week-start": current.week_start, ...attrs };
    return Object.entries(all)
      .map(([k, v]) => ` data-${k}="${escapeHtml(String(v))}"`)
      .join("");
  }

  interface FormState {
    draft: Draft;
    errors: FieldErrors;
  }

  function homePage(visitorId: string, lastName: string, form?: FormState): string {
    const week = store.currentWeek(clock());
    const marks = store.children(week.root_mark_id);
    return page(
      form ? "Not posted yet · Marks" : "Marks",
      `<header>
  <h1>Marks</h1>
  <p><span id="week-label">${escapeHtml(weekLabel(week.week_start))}</span>. Leave a short mark; at 00:00 Monday it's sealed into the <a href="/archive/">archive</a>, for good.</p>
</header>
<main id="content"${liveAttrs({ page: "home", week: week.id, root: week.root_mark_id })}>
${liveStatus}
${postForm({ action: "/", cta: "Leave it", bodyLabel: "Your mark", draft: form?.draft ?? { name: lastName, body: "" }, errors: form?.errors })}
<h2 class="muted">This week</h2>
${wall(week.root_mark_id, marks, visitorId, "No marks yet this week. Be the first.")}
</main>
${PAGE_SCRIPT}`,
      { nav: "home" },
    );
  }

  function markPage(mark: MarkWithCount, visitorId: string, lastName: string, form?: FormState): string {
    const archived = store.isArchived(mark, clock());
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
  } · <span data-count-for="${mark.id}">${replyCount(mark.child_count)}</span></p>
</div>`;
    }
    const title = mark.is_root ? `${mark.body} · Marks` : `${mark.name}: ${[...mark.body].slice(0, 40).join("")} · Marks`;
    return page(
      form ? `Not posted yet · ${title}` : title,
      `${crumbs(store.ancestors(mark))}
<main id="content"${liveAttrs({ page: "mark", mark: mark.id, week: mark.week_id ?? "", archived: archived ? 1 : 0 })}>
${liveStatus}
${heading}
${extra}
<p><a href="/archive/#m-${mark.id}">Find in archive</a></p>
${archived ? sealedNotice(mark.week_id) : postForm({ action: `/m/${mark.id}`, cta: "Reply", bodyLabel: "Your reply", draft: form?.draft ?? { name: lastName, body: "" }, errors: form?.errors })}
<h2 class="muted">${mark.is_root ? "Marks" : "Replies"}</h2>
${wall(mark.id, kids, visitorId, archived ? "No replies, and now there never will be." : "No replies yet.", archived)}
</main>
${PAGE_SCRIPT}`,
    );
  }

  // A rejected reply keeps its draft and offers the one honest alternative:
  // post it as a new mark on the current week.
  function divertedPage(title: string, explanation: string, draft: Draft, back?: Mark): string {
    return page(
      `${title} · Marks`,
      `<main id="content">
<h1>${title}</h1>
${explanation}
<h2>Your draft</h2>
<p>It wasn't posted. You can post it as a new mark on this week instead${back ? `, or <a href="/m/${back.id}">go back to the mark you were replying to</a>` : ""}.</p>
${postForm({ action: "/", cta: "Post it on this week", bodyLabel: "Your mark", draft })}
</main>`,
    );
  }

  function notFoundPage(): string {
    return page(
      "Not found",
      `<main id="content"><h1>Nothing here</h1><p>That mark doesn't exist. <a href="/">Back to this week</a>.</p></main>`,
    );
  }

  function archivePage(): string {
    const current = store.currentWeek(clock());
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
      `<main id="archive"${liveAttrs({ page: "archive", week: current.id, root: current.root_mark_id })}>
<h1>Archive</h1>
<p class="muted" id="archive-intro">Every week of marks, newest first. Each week seals at 00:00 Monday, Sydney time.</p>
${liveStatus}
<section id="list-view" aria-labelledby="list-heading">
<h2 id="list-heading">The whole tree</h2>
${archiveList(store.weeks(), byParent, current.id)}
</section>
</main>`,
      {
        nav: "archive",
        bodyClass: "archive-page",
        head: `<link rel="stylesheet" href="${STATIC}archive.css">
<script type="importmap">${importMap}</script>
<script type="module" src="${STATIC}archive.js"></script>`,
      },
    );
  }

  // The whole tree in one response, presented as children arrays. A week
  // root's parent is the next newer week's root and its leftmost child is the
  // previous week's root; childCount counts only real replies. Never includes
  // visitor_id: `mine` is worked out here, per request. `lastId` is where the
  // live feed should pick up for this snapshot.
  function archiveJson(visitorId: string): unknown {
    const current = store.currentWeek(clock());
    const weeks = store.weeks();
    const byId = new Map(weeks.map((w) => [w.id, w]));
    const newerRoot = new Map<number, number>();
    for (const w of weeks) {
      const prev = w.prev_week_id === null ? undefined : byId.get(w.prev_week_id);
      if (prev) newerRoot.set(prev.root_mark_id, w.root_mark_id);
    }
    const marks = store.allMarks();
    const children = new Map<number, number[]>();
    for (const w of weeks) {
      const prev = w.prev_week_id === null ? undefined : byId.get(w.prev_week_id);
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
      lastId: store.lastMarkId(),
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
    for (const [prefix, dir] of STATIC_ROOTS) {
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
        res.writeHead(200, { "Content-Type": type, "Cache-Control": IMMUTABLE });
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
    lastName: string,
    parentId: number | null,
  ): Promise<void> {
    const action = parentId === null ? "mark.post" : "mark.reply";
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (err) {
      if (!(err instanceof TooLarge)) throw err;
      logger.log({ action, outcome: "rejected", reason: "too-large", parent: parentId, limit: MAX_REQUEST_BYTES });
      res.setHeader("Connection", "close");
      sendHtml(
        res,
        413,
        page(
          "Too long · Marks",
          `<main id="content"><h1>That was too long to accept</h1><p>Nothing was posted: the request was bigger than ${MAX_REQUEST_BYTES} bytes, far past what the form allows. <a href="${parentId === null ? "/" : `/m/${parentId}`}">Go back</a> and try something shorter.</p></main>`,
        ),
      );
      return;
    }

    const params = new URLSearchParams(raw);
    const checked = validateDraft({ name: params.get("name"), body: params.get("body") });
    const { draft } = checked;
    const sizes = { name_chars: draft.name.length, body_chars: draft.body.length };
    const parent = parentId === null ? undefined : store.getMark(parentId);

    if (parentId !== null && !parent) {
      logger.log({ action, outcome: "rejected", reason: "parent-not-found", parent: parentId, ...sizes });
      return sendHtml(
        res,
        404,
        divertedPage("That mark doesn't exist", "<p>There's no mark to reply to at that address.</p>", draft),
      );
    }

    if (!checked.ok) {
      logger.log({
        action,
        outcome: "rejected",
        reason: "invalid-input",
        parent: parentId,
        fields: Object.keys(checked.errors),
        ...sizes,
      });
      const form = { draft, errors: checked.errors };
      if (parent && store.isArchived(parent, clock())) {
        return sendHtml(res, 403, divertedPage("That week is sealed", sealedNotice(parent.week_id), draft, parent));
      }
      return sendHtml(res, 422, parent ? markPage(parent, visitorId, lastName, form) : homePage(visitorId, lastName, form));
    }

    // Everything that could fail is done before the write: the cookie is
    // encoded now, so a successful write is always followed by a 303.
    const nameCookie = cookieHeader("name", draft.name);
    // The week is decided by the clock as it reads now, after the body has
    // arrived, and store.post decides and writes in one synchronous
    // transaction: nothing can slip in between.
    let line: LogLine | undefined;
    const result: PostResult = store.post(visitorId, draft.name, draft.body, parentId, clock(), (r) => {
      const posted = store.getMark(r.parentId);
      const event = logger.event({
        action,
        mark: r.id,
        parent: r.parentId,
        week: r.weekId,
        name: draft.name,
        ...sizes,
        preview: preview(draft.body),
        ...(posted && !posted.is_root ? { parent_actor: actorOf(posted.visitor_id) } : {}),
      });
      line = event.line;
      return event.row;
    });

    if (!result.ok) {
      const reason = result.reason === "archived" ? "sealed" : "parent-not-found";
      const target = parentId === null ? undefined : store.getMark(parentId);
      logger.log({ action, outcome: "rejected", reason, parent: parentId, week: target?.week_id ?? null, ...sizes });
      if (!target) {
        return sendHtml(res, 404, divertedPage("That mark doesn't exist", "<p>There's no mark to reply to.</p>", draft));
      }
      return sendHtml(res, 403, divertedPage("That week is sealed", sealedNotice(target.week_id), draft, target));
    }

    if (line) logger.print(line);
    live.publish(result.id);
    res.appendHeader("Set-Cookie", nameCookie);
    redirect(res, 303, parentId === null ? "/" : `/m/${parentId}`);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if ((req.method === "GET" || req.method === "HEAD") && (await serveStatic(url.pathname, res))) return;

    const visitorId = getVisitorId(req, res);
    const ctx = requestContext.getStore();
    if (ctx) ctx.actor = actorOf(visitorId);
    const lastName = getCookie(req, "name") ?? "";

    if (url.pathname === "/") {
      if (req.method === "POST") return await handlePost(req, res, visitorId, lastName, null);
      if (req.method === "GET") {
        const html = homePage(visitorId, lastName);
        logger.log({ action: "page.view", page: "home", week: store.currentWeek(clock()).id });
        return sendHtml(res, 200, html);
      }
    }

    if (url.pathname.startsWith("/m/")) {
      const id = markId(url.pathname);
      const mark = id === undefined ? undefined : store.getMark(id);
      if (req.method === "POST" && id !== undefined) return await handlePost(req, res, visitorId, lastName, id);
      if (req.method === "GET") {
        if (!mark) return sendHtml(res, 404, notFoundPage());
        if (mark.id === store.currentWeek(clock()).root_mark_id) return redirect(res, 302, "/");
        const html = markPage(mark, visitorId, lastName);
        logger.log({ action: "page.view", page: "mark", mark: mark.id, week: mark.week_id });
        return sendHtml(res, 200, html);
      }
      return sendHtml(res, 404, notFoundPage());
    }

    if (req.method === "GET" && url.pathname === "/archive/") {
      const html = archivePage();
      logger.log({ action: "page.view", page: "archive" });
      return sendHtml(res, 200, html);
    }
    if (req.method === "GET" && url.pathname === "/archive") return redirect(res, 301, "/archive/");

    if (req.method === "GET" && url.pathname === "/archive.json") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" });
      res.end(JSON.stringify(archiveJson(visitorId)));
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      const replayed = live.connect(req, res, visitorId, url.searchParams.get("after"));
      // A plain connect is routine; one that caught up on missed marks is
      // worth a line.
      if (replayed > 0) logger.log({ action: "live.catchup", replayed });
      return;
    }

    if (req.method === "GET" && url.pathname === "/readme/") {
      const md = readFileSync("README.md", "utf8");
      const html = await marked.parse(md);
      return sendHtml(res, 200, page("About this app", `<main>${html}</main>`));
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  }

  const server = createServer((req, res) => {
    const ctx = { rid: newRequestId(), actor: null as string | null };
    res.setHeader("X-Request-Id", ctx.rid);
    void requestContext.run(ctx, async () => {
      try {
        await route(req, res);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.log({ action: "request.error", outcome: "error", reason: message, method: req.method, path: req.url?.split("?")[0] });
        console.error(err);
        if (!res.headersSent) {
          sendHtml(
            res,
            500,
            page(
              "Something went wrong · Marks",
              `<main id="content"><h1>Something went wrong on our side</h1><p>If you were posting, check the page before trying again. Reference: <code>${ctx.rid}</code>.</p><p><a href="/">Back to this week</a></p></main>`,
            ),
          );
        } else {
          res.end();
        }
      }
    });
  });

  return {
    server,
    store,
    live,
    logger,
    close: () =>
      new Promise((done) => {
        live.closeAll();
        server.closeAllConnections();
        server.close(() => {
          store.close();
          done();
        });
      }),
  };
}
