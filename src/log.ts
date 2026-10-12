import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import type { AuditEvent, Store } from "./db.ts";

// The activity log: one JSON object per line on stdout (what `flyctl logs`
// shows), and the same event as a row in the `audit` table, so it's still
// queryable after a restart (scripts/audit.ts). JSON.stringify escapes line
// breaks, so nothing a visitor types can forge an extra log line.
//
// Who did it is `actor`: a short hash of the visitor cookie. It's stable for a
// browser and tells two browsers apart, but the raw cookie never reaches a
// log, a page or the live feed. A name is just what someone typed, so it's
// logged as `name` beside the actor, never as identity.

export interface RequestContext {
  rid: string;
  actor: string | null;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function newRequestId(): string {
  return randomBytes(4).toString("hex");
}

export function actorOf(visitorId: string): string {
  return `v-${createHash("sha256").update(`marks-actor:${visitorId}`).digest("hex").slice(0, 10)}`;
}

export interface LogFields {
  action: string;
  outcome?: "ok" | "rejected" | "error";
  reason?: string;
  mark?: number | null;
  parent?: number | null;
  week?: number | null;
  [key: string]: unknown;
}

export type LogLine = Record<string, unknown> & { ts: string; rid: string | null; actor: string | null; action: string };

export function createLogger(store: Store, clock: () => Date, out: (line: string) => void = (l) => console.log(l)) {
  // The event as both a stdout line and an audit row. `persist: false` is for
  // a row that's already written inside the mark's own transaction.
  function event(fields: LogFields): { line: LogLine; row: AuditEvent } {
    const ctx = requestContext.getStore();
    const { action, outcome = "ok", reason, mark = null, parent = null, week = null, ...detail } = fields;
    const line: LogLine = {
      ts: clock().toISOString(),
      rid: ctx?.rid ?? null,
      actor: ctx?.actor ?? null,
      action,
      outcome,
      ...(reason ? { reason } : {}),
      ...(mark !== null ? { mark } : {}),
      ...(parent !== null ? { parent } : {}),
      ...(week !== null ? { week } : {}),
      ...detail,
    };
    const row: AuditEvent = {
      ts: line.ts,
      request_id: line.rid,
      actor: line.actor,
      action,
      outcome,
      reason: reason ?? null,
      mark_id: mark,
      parent_id: parent,
      week_id: week,
      detail: Object.keys(detail).length ? JSON.stringify(detail) : null,
    };
    return { line, row };
  }

  function log(fields: LogFields): void {
    const { line, row } = event(fields);
    try {
      store.insertAudit(row);
    } catch (err) {
      out(JSON.stringify({ ts: line.ts, rid: line.rid, action: "audit.write", outcome: "error", reason: String(err) }));
    }
    out(JSON.stringify(line));
  }

  return { log, event, print: (line: LogLine) => out(JSON.stringify(line)) };
}

export type Logger = ReturnType<typeof createLogger>;
