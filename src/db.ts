import { DatabaseSync } from "node:sqlite";
import { weekLabel, weekOf } from "./week.ts";

// Every mark, week roots included, is a row in `marks`; the tree is a parent
// pointer, so a mark's children are `where parent_id = ?` and nothing ever
// rewrites a list two posters could race on. `weeks` chains the roots: each
// week's `prev_week_id` is its root's leftmost-child edge into the past.

export interface Mark {
  id: number;
  visitor_id: string;
  name: string;
  body: string;
  created_at: string;
  parent_id: number | null;
  week_id: number | null;
  is_root: number;
}

export interface MarkWithCount extends Mark {
  child_count: number;
}

export interface WeekRow {
  id: number;
  week_start: string;
  root_mark_id: number;
  prev_week_id: number | null;
}

export type PostResult =
  | { ok: true; id: number; parentId: number }
  | { ok: false; reason: "not-found" | "archived" };

export const SYSTEM_VISITOR = "system";
export const SYSTEM_NAME = "Marks";

function columns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`pragma table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

// node:sqlite has no transaction helper; this is the one place that opens one.
function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("begin immediate");
  try {
    const out = fn();
    db.exec("commit");
    return out;
  } catch (err) {
    db.exec("rollback");
    throw err;
  }
}

export function openStore(file: string) {
  const db = new DatabaseSync(file);

  // The original crit-8 table, unchanged, so an existing volume opens as-is;
  // everything after it is additive and safe to run on every boot.
  db.exec(`
    create table if not exists marks (
      id integer primary key autoincrement,
      visitor_id text not null,
      name text not null,
      body text not null,
      created_at text not null
    )
  `);
  const have = columns(db, "marks");
  if (!have.has("parent_id")) db.exec("alter table marks add column parent_id integer references marks(id)");
  if (!have.has("week_id")) db.exec("alter table marks add column week_id integer references weeks(id)");
  if (!have.has("is_root")) db.exec("alter table marks add column is_root integer not null default 0");
  db.exec(`
    create table if not exists weeks (
      id integer primary key autoincrement,
      week_start text not null unique,
      root_mark_id integer not null references marks(id),
      prev_week_id integer references weeks(id)
    );
    create index if not exists marks_parent on marks(parent_id);
    create index if not exists marks_week on marks(week_id);
  `);

  const stmt = {
    weekByStart: db.prepare("select * from weeks where week_start = ?"),
    weekById: db.prepare("select * from weeks where id = ?"),
    weekBefore: db.prepare("select * from weeks where week_start < ? order by week_start desc limit 1"),
    weekAfter: db.prepare("select * from weeks where week_start > ? order by week_start asc limit 1"),
    weeks: db.prepare("select * from weeks order by week_start desc"),
    insertMark: db.prepare(
      "insert into marks (visitor_id, name, body, created_at, parent_id, week_id, is_root) values (?, ?, ?, ?, ?, ?, ?)",
    ),
    insertWeek: db.prepare("insert into weeks (week_start, root_mark_id, prev_week_id) values (?, ?, ?)"),
    setMarkWeek: db.prepare("update marks set week_id = ? where id = ?"),
    relinkWeek: db.prepare("update weeks set prev_week_id = ? where id = ?"),
    orphans: db.prepare(
      "select * from marks where parent_id is null and is_root = 0 and week_id is null order by id",
    ),
    adopt: db.prepare("update marks set parent_id = ?, week_id = ? where id = ?"),
    mark: db.prepare(
      "select m.*, (select count(*) from marks c where c.parent_id = m.id) as child_count from marks m where m.id = ?",
    ),
    children: db.prepare(
      "select m.*, (select count(*) from marks c where c.parent_id = m.id) as child_count from marks m where m.parent_id = ? order by m.id",
    ),
    all: db.prepare(
      "select m.*, (select count(*) from marks c where c.parent_id = m.id) as child_count from marks m order by m.id",
    ),
  };

  // Creates the week's root if it doesn't exist and splices it into the chain
  // after whichever week actually came before (weeks nobody visited get no
  // root). Must run inside a transaction.
  function ensureWeekIn(start: string, startsAt: Date): WeekRow {
    const existing = stmt.weekByStart.get(start) as WeekRow | undefined;
    if (existing) return existing;
    const prev = stmt.weekBefore.get(start) as WeekRow | undefined;
    const next = stmt.weekAfter.get(start) as WeekRow | undefined;
    const root = stmt.insertMark.run(
      SYSTEM_VISITOR,
      SYSTEM_NAME,
      weekLabel(start),
      startsAt.toISOString(),
      null,
      null,
      1,
    );
    const rootId = Number(root.lastInsertRowid);
    const week = stmt.insertWeek.run(start, rootId, prev?.id ?? null);
    const weekId = Number(week.lastInsertRowid);
    stmt.setMarkWeek.run(weekId, rootId);
    // Only the backfill can land a week mid-chain; keep the chain unbroken.
    if (next) stmt.relinkWeek.run(weekId, next.id);
    return stmt.weekById.get(weekId) as unknown as WeekRow;
  }

  // Lazy rollover: there's no cron (the machine sleeps when idle), so every
  // request asks for the current week and the first one after 00:00 Monday
  // creates its root. The unique week_start and the synchronous connection
  // make concurrent first requests idempotent.
  function currentWeek(now: Date): WeekRow {
    const { start, startsAt } = weekOf(now);
    const existing = stmt.weekByStart.get(start) as WeekRow | undefined;
    if (existing) return existing;
    return transaction(db, () => ensureWeekIn(start, startsAt));
  }

  // Backfill: hang every pre-tree mark under the root of the week it was
  // posted in. Names and bodies are never touched.
  transaction(db, () => {
    for (const mark of stmt.orphans.all() as unknown as Mark[]) {
      const { start, startsAt } = weekOf(new Date(mark.created_at));
      const week = ensureWeekIn(start, startsAt);
      stmt.adopt.run(week.root_mark_id, week.id, mark.id);
    }
  });

  function getMark(id: number): MarkWithCount | undefined {
    return stmt.mark.get(id) as MarkWithCount | undefined;
  }

  function getWeek(id: number): WeekRow | undefined {
    return stmt.weekById.get(id) as WeekRow | undefined;
  }

  function isArchived(mark: Mark, now: Date): boolean {
    return mark.week_id !== currentWeek(now).id;
  }

  // A real reply's direct children, oldest first. A week root's previous-week
  // edge lives in `weeks`, not here, so it never shows up as a child.
  function children(id: number): MarkWithCount[] {
    return stmt.children.all(id) as unknown as MarkWithCount[];
  }

  // From the week root down to (not including) the mark itself.
  function ancestors(mark: Mark): MarkWithCount[] {
    const out: MarkWithCount[] = [];
    let parentId = mark.parent_id;
    while (parentId !== null) {
      const parent = getMark(parentId);
      if (!parent) break;
      out.unshift(parent);
      parentId = parent.parent_id;
    }
    return out;
  }

  function post(
    visitorId: string,
    name: string,
    body: string,
    parentId: number | null,
    now: Date,
  ): PostResult {
    const week = currentWeek(now);
    const parent = getMark(parentId ?? week.root_mark_id);
    if (!parent) return { ok: false, reason: "not-found" };
    // Archived means sealed: anything under a past week is read-only for good.
    if (parent.week_id !== week.id) return { ok: false, reason: "archived" };
    const res = stmt.insertMark.run(visitorId, name, body, now.toISOString(), parent.id, week.id, 0);
    return { ok: true, id: Number(res.lastInsertRowid), parentId: parent.id };
  }

  function weeks(): WeekRow[] {
    return stmt.weeks.all() as unknown as WeekRow[];
  }

  function allMarks(): MarkWithCount[] {
    return stmt.all.all() as unknown as MarkWithCount[];
  }

  return { currentWeek, getMark, getWeek, isArchived, children, ancestors, post, weeks, allMarks, close: () => db.close() };
}

export type Store = ReturnType<typeof openStore>;
