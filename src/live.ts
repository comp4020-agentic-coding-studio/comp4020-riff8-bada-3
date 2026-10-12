import type { IncomingMessage, ServerResponse } from "node:http";
import type { MarkWithCount, Store, WeekRow } from "./db.ts";
import { weekLabel, weekOf } from "./week.ts";

// The live feed: server-sent events over a plain response, inside the one Node
// process. Marks are append-only and their ids only grow, so the feed is just
// "every row in `marks` after the one you last saw", in id order: a new mark
// is a `mark` event, a lazily created week root is a `week` event, and the SSE
// id is the row id. On reconnect the browser sends Last-Event-ID and gets
// what it missed from the table itself, so nothing is held in memory and a
// restart loses nothing. Every connection gets its own JSON, because `mine`
// depends on who's listening; the visitor id itself is never sent.

const REPLAY_LIMIT = 500;
const PING_MS = 25_000;

interface Connection {
  res: ServerResponse;
  visitorId: string;
}

export interface MarkEvent {
  id: number;
  parentId: number;
  weekId: number;
  name: string;
  body: string;
  createdAt: string;
  childCount: number;
  parentChildCount: number;
  mine: boolean;
}

export interface WeekEvent {
  id: number;
  weekStart: string;
  label: string;
  rootMarkId: number;
  prevWeekId: number | null;
  prevRootMarkId: number | null;
}

function frame(event: string, data: unknown, id?: number): string {
  return `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createLive(store: Store, clock: () => Date) {
  const connections = new Set<Connection>();
  let ping: ReturnType<typeof setInterval> | undefined;

  function weekEvent(row: MarkWithCount): WeekEvent | undefined {
    const week = row.week_id === null ? undefined : store.getWeek(row.week_id);
    if (!week) return undefined;
    const prev = week.prev_week_id === null ? undefined : store.getWeek(week.prev_week_id);
    return {
      id: week.id,
      weekStart: week.week_start,
      label: weekLabel(week.week_start),
      rootMarkId: week.root_mark_id,
      prevWeekId: week.prev_week_id,
      prevRootMarkId: prev?.root_mark_id ?? null,
    };
  }

  // Counts are read when the event is sent, so a replayed event carries
  // today's counts, not the ones from when it happened.
  function frameFor(row: MarkWithCount, visitorId: string): string | undefined {
    if (row.is_root) {
      const week = weekEvent(row);
      return week ? frame("week", week, row.id) : undefined;
    }
    if (row.parent_id === null || row.week_id === null) return undefined;
    const data: MarkEvent = {
      id: row.id,
      parentId: row.parent_id,
      weekId: row.week_id,
      name: row.name,
      body: row.body,
      createdAt: row.created_at,
      childCount: store.childCount(row.id),
      parentChildCount: store.childCount(row.parent_id),
      mine: row.visitor_id === visitorId,
    };
    return frame("mark", data, row.id);
  }

  function write(conn: Connection, text: string): void {
    if (!conn.res.writableEnded && !conn.res.destroyed) conn.res.write(text);
  }

  // After a row commits: every open connection gets it, personalised.
  function publish(markId: number): void {
    const row = store.getMark(markId);
    if (!row) return;
    for (const conn of connections) {
      const text = frameFor(row, conn.visitorId);
      if (text) write(conn, text);
    }
  }

  function published(week: WeekRow): void {
    publish(week.root_mark_id);
  }

  function hello(): unknown {
    const now = clock();
    const week = store.currentWeek(now);
    const next = weekOf(new Date(weekOf(now).startsAt.getTime() + 8 * 86_400_000));
    return {
      now: now.toISOString(),
      sealsAt: next.startsAt.toISOString(),
      currentWeekId: week.id,
      currentRootId: week.root_mark_id,
      lastId: store.lastMarkId(),
    };
  }

  // GET /events[?after=<id>]. Last-Event-ID (the browser's own reconnect)
  // wins over ?after= (a page's first connect, from the newest id it
  // rendered). Neither means "from now on": no history is replayed.
  function connect(req: IncomingMessage, res: ServerResponse, visitorId: string, after: string | null): number {
    const header = req.headers["last-event-id"];
    const from = Number(typeof header === "string" && header !== "" ? header : (after ?? NaN));

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    res.on("error", () => {});
    // Asking for the current week is what rolls it over: a page that crosses
    // midnight reconnects, and its reconnect creates the new root (which
    // `published` sends to everyone already listening).
    const greeting = hello();
    let text = `retry: 2000\n\n${frame("hello", greeting)}`;
    let replayed = 0;
    if (Number.isFinite(from) && from >= 0) {
      const rows = store.marksAfter(from, REPLAY_LIMIT + 1);
      if (rows.length > REPLAY_LIMIT) {
        text += frame("resync", { reason: "too many changes to replay" });
      } else {
        for (const row of rows) {
          const f = frameFor(row, visitorId);
          if (f) (text += f), replayed++;
        }
      }
    }
    res.write(text);

    // No await between the replay query and joining the set, so no write can
    // fall between them.
    const conn: Connection = { res, visitorId };
    connections.add(conn);
    ping ??= setInterval(() => {
      for (const c of connections) write(c, ": ping\n\n");
    }, PING_MS).unref();
    res.on("close", () => {
      connections.delete(conn);
      if (connections.size === 0 && ping) {
        clearInterval(ping);
        ping = undefined;
      }
    });
    return replayed;
  }

  function closeAll(): void {
    for (const c of connections) c.res.end();
    connections.clear();
  }

  return { connect, publish, published, closeAll, size: () => connections.size };
}

export type Live = ReturnType<typeof createLive>;
