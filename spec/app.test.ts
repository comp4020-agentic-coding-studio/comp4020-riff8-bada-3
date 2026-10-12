import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, MAX_REQUEST_BYTES, type App } from "../src/app.ts";

// The checks that need the server's clock or its logs, so they can't run
// against the shared app: each starts its own in this process, on a scratch
// DATA_DIR and a free port, with a clock the test moves by hand.

const SUNDAY_LATE = new Date("2026-10-11T12:59:59Z"); // Sun 11 Oct 23:59:59 Sydney (AEDT)
const MONDAY_EARLY = new Date("2026-10-11T13:00:01Z"); // Mon 12 Oct 00:00:01
const WEDNESDAY = new Date("2026-10-14T01:00:00Z");

interface Running {
  app: App;
  url: string;
  dir: string;
  lines: string[];
  clock: { now: Date };
}

const running: Running[] = [];

async function start(now: Date, dir = mkdtempSync(join(tmpdir(), "marks-app-"))): Promise<Running> {
  const clock = { now };
  const lines: string[] = [];
  const app = createApp({ dataDir: dir, clock: () => clock.now, out: (l) => lines.push(l) });
  await new Promise<void>((done) => app.server.listen(0, "127.0.0.1", done));
  const r = { app, url: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`, dir, lines, clock };
  running.push(r);
  return r;
}

async function stop(r: Running): Promise<void> {
  running.splice(running.indexOf(r), 1);
  await r.app.close();
}

afterEach(async () => {
  for (const r of [...running]) {
    await stop(r);
    rmSync(r.dir, { recursive: true, force: true });
  }
});

const visitor = () => `visitor=${randomUUID()}`;

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function post(r: Running, path: string, fields: Record<string, string>, cookie = visitor()) {
  const res = await fetch(r.url + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: form(fields),
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location"), html: await res.text() };
}

const bodies = (r: Running) => r.app.store.allMarks().filter((m) => !m.is_root);
const doc = (html: string) => new JSDOM(html).window.document;

// A POST whose body arrives in two halves, with `between` run in the gap.
function slowPost(r: Running, path: string, body: string, cookie: string, between: () => void) {
  return new Promise<{ status: number; html: string }>((done, fail) => {
    const req = request(
      r.url + path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          Cookie: cookie,
        },
      },
      (res) => {
        let html = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (html += c));
        res.on("end", () => done({ status: res.statusCode ?? 0, html }));
      },
    );
    req.on("error", fail);
    req.write(body.slice(0, 12));
    setTimeout(() => {
      between();
      req.end(body.slice(12));
    }, 80);
  });
}

describe("sealing is decided when the write happens", () => {
  it("rejects a reply that starts Sunday 23:59:59 and finishes after midnight, keeping the draft", async () => {
    const r = await start(SUNDAY_LATE);
    const a = visitor();
    await post(r, "/", { name: "Ana", body: "last thing on Sunday" }, a);
    const parent = bodies(r)[0];
    const oldWeek = parent.week_id;
    const before = r.app.store.allMarks().filter((m) => m.week_id === oldWeek).length;

    const res = await slowPost(r, `/m/${parent.id}`, form({ name: "Bo", body: "a reply that missed the bell" }), visitor(), () => {
      r.clock.now = MONDAY_EARLY;
    });

    expect(res.status).toBe(403);
    expect(r.app.store.allMarks().filter((m) => m.week_id === oldWeek)).toHaveLength(before);
    expect(bodies(r).some((m) => m.body === "a reply that missed the bell")).toBe(false);
    const page = doc(res.html);
    expect(page.querySelector("h1")?.textContent).toMatch(/sealed/);
    const diverted = page.querySelector('form[action="/"]');
    expect(diverted?.querySelector("textarea")?.textContent).toBe("a reply that missed the bell");
    expect(diverted?.querySelector<HTMLInputElement>("input[name=name]")?.value).toBe("Bo");
    expect(page.querySelector(`a[href="/m/${parent.id}"]`)).not.toBeNull();
  });

  it("files a home-page post that crosses midnight under the new week only", async () => {
    const r = await start(SUNDAY_LATE);
    const oldWeek = r.app.store.currentWeek(SUNDAY_LATE);
    const res = await slowPost(r, "/", form({ name: "Cy", body: "first of the new week" }), visitor(), () => {
      r.clock.now = MONDAY_EARLY;
    });
    expect(res.status).toBe(303);
    const newWeek = r.app.store.currentWeek(MONDAY_EARLY);
    expect(newWeek.id).not.toBe(oldWeek.id);
    const mark = bodies(r).find((m) => m.body === "first of the new week")!;
    expect(mark.week_id).toBe(newWeek.id);
    expect(mark.parent_id).toBe(newWeek.root_mark_id);
    expect(r.app.store.children(oldWeek.root_mark_id)).toHaveLength(0);
  });
});

describe("validation never shortens a permanent mark", () => {
  const smile = "\u{1F600}"; // two UTF-16 code units

  it("rejects a name whose emoji would cross the 40 limit, storing nothing and keeping the draft", async () => {
    const r = await start(WEDNESDAY);
    const name = "a".repeat(39) + smile;
    const res = await post(r, "/", { name, body: "hello" });
    expect(res.status).toBe(422);
    expect(bodies(r)).toHaveLength(0);
    const page = doc(res.html);
    const input = page.querySelector<HTMLInputElement>("#name")!;
    expect(input.value).toBe(name);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain("name-error");
    expect(page.getElementById("name-error")?.textContent).toMatch(/41 characters.*at most 40/);
    expect(page.querySelector("#body")?.textContent).toBe("hello");
    expect(page.querySelector("#body")?.hasAttribute("aria-invalid")).toBe(false);
  });

  it("stores names and bodies exactly at the limit intact, emoji included", async () => {
    const r = await start(WEDNESDAY);
    const name = "a".repeat(38) + smile;
    const body = "b".repeat(278) + smile;
    const res = await post(r, "/", { name, body });
    expect(res.status).toBe(303);
    const [mark] = bodies(r);
    expect(mark.name).toBe(name);
    expect(mark.body).toBe(body);
    expect(mark.name.isWellFormed() && mark.body.isWellFormed()).toBe(true);
  });

  it("rejects a body one over the limit, by an emoji or by a letter", async () => {
    const r = await start(WEDNESDAY);
    for (const body of ["b".repeat(279) + smile, "b".repeat(281)]) {
      const res = await post(r, "/", { name: "Ana", body });
      expect(res.status).toBe(422);
      expect(doc(res.html).querySelector("#body")?.textContent).toBe(body);
      expect(doc(res.html).querySelector("#body")?.getAttribute("aria-invalid")).toBe("true");
    }
    expect(bodies(r)).toHaveLength(0);
  });

  it("counts a line break as one character, as the textarea does", async () => {
    const r = await start(WEDNESDAY);
    // 263 letters and 10 line breaks: 273 in the browser, 283 as submitted (CRLF)
    const body = Array.from({ length: 10 }, () => "c".repeat(26)).join("\r\n") + "\r\nend";
    expect(body.replace(/\r\n/g, "\n").length).toBeLessThanOrEqual(280);
    expect(body.length).toBeGreaterThan(280);
    expect((await post(r, "/", { name: "Ana", body })).status).toBe(303);
    expect(bodies(r)[0].body).toBe(body.replace(/\r\n/g, "\n"));
  });

  it("explains whitespace-only and zero-width-only input instead of a silent redirect", async () => {
    const r = await start(WEDNESDAY);
    for (const [name, body, bad] of [
      ["Ana", "   \n  ", "body"],
      ["​​", "hi", "name"],
      ["Ana", "​⁠﻿", "body"],
    ]) {
      const res = await post(r, "/", { name, body });
      expect(res.status).toBe(422);
      const page = doc(res.html);
      expect(page.querySelector(`#${bad}`)?.getAttribute("aria-invalid")).toBe("true");
      expect(page.getElementById(`${bad}-error`)?.textContent).toBeTruthy();
      expect(page.querySelector('[role="alert"]')).not.toBeNull();
    }
    expect(bodies(r)).toHaveLength(0);
  });

  it("returns the reply form with field errors on a mark page", async () => {
    const r = await start(WEDNESDAY);
    await post(r, "/", { name: "Ana", body: "parent" });
    const parent = bodies(r)[0];
    const res = await post(r, `/m/${parent.id}`, { name: "Bo", body: "" });
    expect(res.status).toBe(422);
    const page = doc(res.html);
    expect(page.querySelector(`form[action="/m/${parent.id}"] #name`)?.getAttribute("value")).toBe("Bo");
    expect(page.querySelector("#body")?.getAttribute("aria-invalid")).toBe("true");
    expect(bodies(r)).toHaveLength(1);
  });

  it("answers an oversized request with 413 and stores nothing", async () => {
    const r = await start(WEDNESDAY);
    const res = await post(r, "/", { name: "Ana", body: "x".repeat(MAX_REQUEST_BYTES + 10) });
    expect(res.status).toBe(413);
    expect(bodies(r)).toHaveLength(0);
    expect(r.lines.map((l) => JSON.parse(l)).some((e) => e.reason === "too-large")).toBe(true);
  });
});

// A minimal SSE client over fetch: frames are collected as they arrive.
interface Frame {
  id?: string;
  event: string;
  data: unknown;
}

async function listen(r: Running, cookie: string, query = "", headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const res = await fetch(`${r.url}/events${query}`, { headers: { Cookie: cookie, ...headers }, signal: ctrl.signal });
  const frames: Frame[] = [];
  let raw = "";
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        const text = decoder.decode(value, { stream: true });
        raw += text;
        buf += text;
        let at: number;
        while ((at = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, at);
          buf = buf.slice(at + 2);
          const f: Partial<Frame> & { lines: string[] } = { event: "message", lines: [] };
          for (const line of block.split("\n")) {
            if (line.startsWith("id: ")) f.id = line.slice(4);
            else if (line.startsWith("event: ")) f.event = line.slice(7);
            else if (line.startsWith("data: ")) f.lines.push(line.slice(6));
          }
          if (f.lines.length) frames.push({ id: f.id, event: f.event!, data: JSON.parse(f.lines.join("\n")) });
        }
      }
    } catch {
      // aborted
    }
  })();
  async function waitFor(pred: (f: Frame) => boolean, ms = 1000): Promise<Frame> {
    const until = Date.now() + ms;
    for (;;) {
      const hit = frames.find(pred);
      if (hit) return hit;
      if (Date.now() > until) throw new Error(`no matching event within ${ms} ms`);
      await new Promise((d) => setTimeout(d, 10));
    }
  }
  return { frames, waitFor, raw: () => raw, close: () => ctrl.abort() };
}

type MarkData = { id: number; parentId: number; body: string; mine: boolean; parentChildCount: number; childCount: number };
const isMark = (body: string) => (f: Frame) => f.event === "mark" && (f.data as MarkData).body === body;

describe("live updates", () => {
  it("sends each session its own copy of a new mark within a second, with `mine` worked out per listener", async () => {
    const r = await start(WEDNESDAY);
    const [aId, bId] = [randomUUID(), randomUUID()];
    const [a, b] = [`visitor=${aId}`, `visitor=${bId}`];
    const streamA = await listen(r, a);
    const streamB = await listen(r, b);
    await streamA.waitFor((f) => f.event === "hello");

    const t0 = Date.now();
    await post(r, "/", { name: "Ana", body: "from A" }, a);
    const forA = (await streamA.waitFor(isMark("from A"))).data as MarkData;
    const forB = (await streamB.waitFor(isMark("from A"))).data as MarkData;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(forA.mine).toBe(true);
    expect(forB.mine).toBe(false);

    await post(r, `/m/${forA.id}`, { name: "Bo", body: "B replies" }, b);
    const reply = (await streamA.waitFor(isMark("B replies"))).data as MarkData;
    expect(reply).toMatchObject({ parentId: forA.id, parentChildCount: 1, mine: false });
    expect(((await streamB.waitFor(isMark("B replies"))).data as MarkData).mine).toBe(true);

    for (const raw of [streamA.raw(), streamB.raw()]) {
      expect(raw).not.toContain(aId);
      expect(raw).not.toContain(bId);
      expect(raw).not.toContain("visitor");
    }
    streamA.close();
    streamB.close();
  });

  it("broadcasts nothing for a rejected post", async () => {
    const r = await start(WEDNESDAY);
    const s = await listen(r, visitor());
    await s.waitFor((f) => f.event === "hello");
    await post(r, "/", { name: "", body: "nameless" });
    await post(r, "/m/99999", { name: "Ana", body: "ghost" });
    await post(r, "/", { name: "Ana", body: "real" });
    await s.waitFor(isMark("real"));
    expect(s.frames.filter((f) => f.event === "mark")).toHaveLength(1);
    s.close();
  });

  it("replays what a reconnecting session missed, with today's counts, and nothing twice", async () => {
    const r = await start(WEDNESDAY);
    const cookie = visitor();
    await post(r, "/", { name: "Ana", body: "before" });
    const first = await listen(r, cookie);
    // no ?after and no Last-Event-ID: nothing is replayed
    await expect(first.waitFor(isMark("before"), 200)).rejects.toThrow();
    await post(r, "/", { name: "Ana", body: "while connected" });
    const last = await first.waitFor(isMark("while connected"));
    first.close();

    // missed while away
    await post(r, `/m/${(last.data as MarkData).id}`, { name: "Bo", body: "missed 1" });
    await post(r, `/m/${(last.data as MarkData).id}`, { name: "Cy", body: "missed 2" });

    const again = await listen(r, cookie, "?after=0", { "Last-Event-ID": last.id! });
    await again.waitFor(isMark("missed 2"));
    const marks = again.frames.filter((f) => f.event === "mark").map((f) => f.data as MarkData);
    expect(marks.map((m) => m.body)).toEqual(["missed 1", "missed 2"]);
    expect(marks.every((m) => m.parentChildCount === 2)).toBe(true);
    again.close();
  });

  it("delivers concurrent appends once each, in id order", async () => {
    const r = await start(WEDNESDAY);
    const s = await listen(r, visitor());
    await s.waitFor((f) => f.event === "hello");
    await Promise.all(Array.from({ length: 25 }, (_, i) => post(r, "/", { name: `P${i}`, body: `burst ${i}` })));
    await s.waitFor(() => s.frames.filter((f) => f.event === "mark").length >= 25);
    const ids = s.frames.filter((f) => f.event === "mark").map((f) => Number(f.id));
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
    expect(bodies(r)).toHaveLength(25);
    s.close();
  });

  it("tells open sessions about the lazy rollover when the first request after midnight makes it", async () => {
    const r = await start(SUNDAY_LATE);
    const s = await listen(r, visitor());
    const hello = (await s.waitFor((f) => f.event === "hello")).data as { sealsAt: string };
    expect(hello.sealsAt).toBe("2026-10-11T13:00:00.000Z");
    r.clock.now = MONDAY_EARLY;
    const other = await listen(r, visitor()); // a reconnect at midnight is a request
    const week = (await s.waitFor((f) => f.event === "week")).data as { label: string; prevRootMarkId: number };
    expect(week.label).toBe("Week of 12 Oct 2026");
    expect(week.prevRootMarkId).toBe(r.app.store.currentWeek(SUNDAY_LATE).root_mark_id);
    s.close();
    other.close();
  });
});

describe("the activity log", () => {
  const events = (r: Running) => r.lines.map((l) => JSON.parse(l) as Record<string, unknown>);

  it("tells two browsers apart and names targets and reasons, without raw ids or bodies", async () => {
    const r = await start(SUNDAY_LATE);
    const [aId, bId] = [randomUUID(), randomUUID()];
    const [a, b] = [`visitor=${aId}`, `visitor=${bId}`];
    await fetch(r.url + "/", { headers: { Cookie: a } });
    await post(r, "/", { name: "Ana", body: "A's mark, which is long enough to be cut in the log" }, a);
    const parent = bodies(r)[0];
    await post(r, `/m/${parent.id}`, { name: "Bo", body: "B's reply" }, b);
    await post(r, `/m/${parent.id}`, { name: "Bo", body: "" }, b);
    await post(r, "/m/424242", { name: "Bo", body: "nowhere" }, b);
    r.clock.now = MONDAY_EARLY;
    await post(r, `/m/${parent.id}`, { name: "Bo", body: "too late" }, b);

    const log = events(r);
    const posted = log.find((e) => e.action === "mark.post")!;
    const replied = log.find((e) => e.action === "mark.reply" && e.outcome === "ok")!;
    expect(posted.actor).not.toBe(replied.actor);
    expect(posted).toMatchObject({ outcome: "ok", mark: parent.id, name: "Ana" });
    expect(replied).toMatchObject({ parent: parent.id, parent_actor: posted.actor, name: "Bo" });
    const rejected = log.filter((e) => e.outcome === "rejected");
    expect(rejected.map((e) => e.reason)).toEqual(["invalid-input", "parent-not-found", "sealed"]);
    expect(rejected.every((e) => e.actor === replied.actor)).toBe(true);
    expect(rejected[2]).toMatchObject({ parent: parent.id, week: parent.week_id });
    expect(log.some((e) => e.action === "week.rollover")).toBe(true);
    expect(log.some((e) => e.action === "page.view" && e.actor === posted.actor)).toBe(true);
    for (const e of log) expect(e.rid).toMatch(/^[0-9a-f]{8}$/);

    const all = r.lines.join("\n");
    expect(all).not.toContain(aId);
    expect(all).not.toContain(bId);
    expect(all).not.toContain("which is long enough to be cut in the log");
  });

  it("keeps one JSON object per line whatever is typed", async () => {
    const r = await start(WEDNESDAY);
    await post(r, "/", { name: 'Eve\n{"action":"forged"}', body: "x\n{\"action\":\"forged\"}" });
    for (const l of r.lines) expect(() => JSON.parse(l)).not.toThrow();
    expect(events(r).some((e) => e.action === "forged")).toBe(false);
  });

  it("is queryable after a restart, alongside unchanged marks", async () => {
    const first = await start(WEDNESDAY);
    const a = visitor();
    await post(first, "/", { name: "Ana", body: "survives" }, a);
    const before = first.app.store.allMarks();
    const actor = events(first).find((e) => e.action === "mark.post")!.actor as string;
    const dir = first.dir;
    await stop(first);

    const second = await start(WEDNESDAY, dir);
    expect(second.app.store.allMarks()).toEqual(before);
    const rows = second.app.store.queryAudit({ actor, action: "mark.post" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "ok", mark_id: before.find((m) => m.body === "survives")!.id });
  });

  it("logs an internal error with the request id the visitor sees", async () => {
    const r = await start(WEDNESDAY);
    r.app.store.close(); // every query now throws
    const res = await fetch(r.url + "/");
    expect(res.status).toBe(500);
    const rid = res.headers.get("x-request-id")!;
    expect(await res.text()).toContain(rid);
    expect(events(r).find((e) => e.action === "request.error")).toMatchObject({ rid, outcome: "error" });
    r.app.store.close = () => {};
  });
});

describe("the archive under a deep thread", () => {
  it("renders a 3,000-deep reply chain in full, as HTML and JSON", async () => {
    const r = await start(WEDNESDAY);
    let parent: number | null = null;
    for (let i = 0; i < 3000; i++) {
      const res = r.app.store.post("deep", "Deep", `level ${i}`, parent, WEDNESDAY);
      if (!res.ok) throw new Error(res.reason);
      parent = res.id;
    }
    const html = await fetch(r.url + "/archive/");
    expect(html.status).toBe(200);
    const text = await html.text();
    for (const m of bodies(r)) expect(text).toContain(`id="m-${m.id}"`);
    const json = (await (await fetch(r.url + "/archive.json")).json()) as { marks: unknown[] };
    expect(json.marks).toHaveLength(r.app.store.allMarks().length);
    expect((await fetch(`${r.url}/m/${parent}`)).status).toBe(200);
  }, 60_000); // each of the 3,000 inserts is its own committed transaction
});
