#!/usr/bin/env node
// Reads the audit trail the server writes (src/log.ts) from the SQLite file,
// read-only. Server-local on purpose: there is no public page or API for it.
//
//   node scripts/audit.ts [--actor v-1a2b3c4d5e] [--action mark.reply]
//                         [--mark 42] [--since 2026-10-12T00:00] [--until ...]
//                         [--limit 200] [--json]
//
// --mark matches the mark itself or anything posted under it. Times are UTC
// ISO prefixes, as stored. On Fly:
//   flyctl ssh console -a <app> -C "node scripts/audit.ts --actor v-..."
// Locally, DATA_DIR points at the directory holding marks.sqlite.
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { selectAudit } from "../src/db.ts";

const { values } = parseArgs({
  options: {
    actor: { type: "string" },
    action: { type: "string" },
    mark: { type: "string" },
    since: { type: "string" },
    until: { type: "string" },
    limit: { type: "string", default: "200" },
    json: { type: "boolean", default: false },
  },
});

const db = new DatabaseSync(`${process.env.DATA_DIR ?? "/data"}/marks.sqlite`, { readOnly: true });
const rows = selectAudit(db, {
  actor: values.actor,
  action: values.action,
  mark: values.mark === undefined ? undefined : Number(values.mark),
  since: values.since,
  until: values.until,
  limit: Number(values.limit),
});

for (const r of rows) {
  if (values.json) {
    console.log(JSON.stringify(r));
    continue;
  }
  const target = [r.mark_id && `mark ${r.mark_id}`, r.parent_id && `under ${r.parent_id}`, r.week_id && `week ${r.week_id}`]
    .filter(Boolean)
    .join(", ");
  console.log(
    [r.ts, r.request_id ?? "-", r.actor ?? "-", r.action, r.outcome, r.reason ?? "", target, r.detail ?? ""]
      .join("  ")
      .trimEnd(),
  );
}
if (rows.length === 0) console.error("no matching events");
