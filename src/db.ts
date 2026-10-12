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
  | { ok: true; id: number; parentId: number; weekId: number }
  | { ok: false; reason: "not-found" | "archived" };

// One row of the audit trail (src/log.ts writes them; scripts/audit.ts reads
// them). `detail` is a JSON object of anything else worth keeping.
export interface AuditEvent {
  ts: string;
  request_id: string | null;
  actor: string | null;
  action: string;
  outcome: string;
  reason: string | null;
  mark_id: number | null;
  parent_id: number | null;
  week_id: number | null;
  detail: string | null;
}

export interface AuditFilter {
  actor?: string;
  action?: string;
  mark?: number;
  since?: string;
  until?: string;
  limit?: number;
}

export const SYSTEM_VISITOR = "system";
export const SYSTEM_NAME = "Marks";

export type AuditRow = AuditEvent & { id: number };

// The newest `limit` matching events, oldest first. `mark` matches the mark
// itself or anything posted under it. Shared with scripts/audit.ts.
export function selectAudit(db: DatabaseSync, f: AuditFilter = {}): AuditRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.actor) (where.push("actor = ?"), args.push(f.actor));
  if (f.action) (where.push("action = ?"), args.push(f.action));
  if (f.mark !== undefined) (where.push("(mark_id = ? or parent_id = ?)"), args.push(f.mark, f.mark));
  if (f.since) (where.push("ts >= ?"), args.push(f.since));
  if (f.until) (where.push("ts < ?"), args.push(f.until));
  const filter = where.length ? ` where ${where.join(" and ")}` : "";
  const sql = `select * from (select * from audit${filter} order by id desc limit ?) order by id`;
  return db.prepare(sql).all(...args, f.limit ?? 200) as unknown as AuditRow[];
}

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

export interface StoreOptions {
  // Called after the transaction that lazily created a week's root commits.
  onWeekCreated?: (week: WeekRow) => void;
}

export function openStore(file: string, opts: StoreOptions = {}) {
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
    create table if not exists audit (
      id integer primary key autoincrement,
      ts text not null,
      request_id text,
      actor text,
      action text not null,
      outcome text not null,
      reason text,
      mark_id integer,
      parent_id integer,
      week_id integer,
      detail text
    );
    create index if not exists audit_ts on audit(ts);
    create index if not exists audit_actor on audit(actor, ts);
    create index if not exists audit_mark on audit(mark_id);
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
    after: db.prepare(
      "select m.*, (select count(*) from marks c where c.parent_id = m.id) as child_count from marks m where m.id > ? order by m.id limit ?",
    ),
    maxId: db.prepare("select coalesce(max(id), 0) as id from marks"),
    childCount: db.prepare("select count(*) as n from marks where parent_id = ?"),
    insertAudit: db.prepare(
      "insert into audit (ts, request_id, actor, action, outcome, reason, mark_id, parent_id, week_id, detail) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    const week = transaction(db, () => ensureWeekIn(start, startsAt));
    opts.onWeekCreated?.(week);
    return week;
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

  function insertAudit(e: AuditEvent): void {
    stmt.insertAudit.run(
      e.ts,
      e.request_id,
      e.actor,
      e.action,
      e.outcome,
      e.reason,
      e.mark_id,
      e.parent_id,
      e.week_id,
      e.detail,
    );
  }

  // The sealing decision and the write happen in one synchronous transaction,
  // against the `now` the caller read after the request body arrived, so no
  // other request (and no midnight) can land between them. A successful
  // mark's audit row commits with it: `audit` turns the result into the row.
  function post(
    visitorId: string,
    name: string,
    body: string,
    parentId: number | null,
    now: Date,
    audit?: (result: Extract<PostResult, { ok: true }>) => AuditEvent,
  ): PostResult {
    const { start, startsAt } = weekOf(now);
    let created = false;
    const result = transaction(db, (): PostResult => {
      created = !stmt.weekByStart.get(start);
      const week = ensureWeekIn(start, startsAt);
      const parent = getMark(parentId ?? week.root_mark_id);
      if (!parent) return { ok: false, reason: "not-found" };
      // Archived means sealed: anything under a past week is read-only for good.
      if (parent.week_id !== week.id) return { ok: false, reason: "archived" };
      const res = stmt.insertMark.run(visitorId, name, body, now.toISOString(), parent.id, week.id, 0);
      const ok = { ok: true as const, id: Number(res.lastInsertRowid), parentId: parent.id, weekId: week.id };
      if (audit) insertAudit(audit(ok));
      return ok;
    });
    if (created) opts.onWeekCreated?.(stmt.weekByStart.get(start) as unknown as WeekRow);
    return result;
  }

  // Every row after `id`, oldest first: the live feed's catch-up, since
  // marks are append-only and ids only grow.
  function marksAfter(id: number, limit: number): MarkWithCount[] {
    return stmt.after.all(id, limit) as unknown as MarkWithCount[];
  }

  function lastMarkId(): number {
    return (stmt.maxId.get() as { id: number }).id;
  }

  function childCount(id: number): number {
    return (stmt.childCount.get(id) as { n: number }).n;
  }

  function queryAudit(f: AuditFilter = {}): AuditRow[] {
    return selectAudit(db, f);
  }

  function weeks(): WeekRow[] {
    return stmt.weeks.all() as unknown as WeekRow[];
  }

  function allMarks(): MarkWithCount[] {
    return stmt.all.all() as unknown as MarkWithCount[];
  }

  return {
    currentWeek,
    getMark,
    getWeek,
    isArchived,
    children,
    ancestors,
    post,
    weeks,
    allMarks,
    marksAfter,
    lastMarkId,
    childCount,
    insertAudit,
    queryAudit,
    close: () => db.close(),
  };
}

export type Store = ReturnType<typeof openStore>;
