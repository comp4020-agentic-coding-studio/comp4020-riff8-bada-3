import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";

// The tree of marks, checked against the RUNNING app (see
// spec/global-setup.ts), same as invariants.test.ts: post on this week's root,
// reply under any mark, and read the whole tree back from the archive.
const baseUrl = inject("baseUrl");

async function post(path: string, name: string, body: string, cookie?: string): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams({ name, body }).toString(),
    redirect: "manual",
  });
}

async function html(path: string): Promise<string> {
  const res = await fetch(new URL(path, baseUrl));
  expect(res.status).toBe(200);
  return res.text();
}

interface ArchiveMark {
  id: number;
  parentId: number | null;
  weekId: number;
  name: string;
  body: string;
  createdAt: string;
  childCount: number;
  children: number[];
  mine: boolean;
}

interface Archive {
  currentWeekId: number;
  weeks: { id: number; rootMarkId: number; weekStart: string; label: string }[];
  marks: ArchiveMark[];
}

async function archive(): Promise<Archive> {
  const res = await fetch(new URL("/archive.json", baseUrl));
  expect(res.status).toBe(200);
  return (await res.json()) as Archive;
}

async function findMark(body: string): Promise<ArchiveMark> {
  const mark = (await archive()).marks.find((m) => m.body === body);
  expect(mark, `no mark with body ${body}`).toBeDefined();
  return mark!;
}

it("a mark posted on / shows up on /", async () => {
  const marker = `mark-${randomUUID()}`;
  const res = await post("/", "Test Visitor", marker);
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/");
  expect(await html("/")).toContain(marker);
});

it("a reply on /m/<id> shows up there and not on /", async () => {
  const parentBody = `parent-${randomUUID()}`;
  await post("/", "Parent", parentBody);
  const parent = await findMark(parentBody);

  const replyBody = `reply-${randomUUID()}`;
  const res = await post(`/m/${parent.id}`, "Replier", replyBody);
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe(`/m/${parent.id}`);

  expect(await html(`/m/${parent.id}`)).toContain(replyBody);
  expect(await html("/")).not.toContain(replyBody);
});

it("reply counts are right, on the wall and in the archive", async () => {
  const parentBody = `counted-${randomUUID()}`;
  await post("/", "Counter", parentBody);
  const parent = await findMark(parentBody);
  for (let i = 0; i < 3; i++) await post(`/m/${parent.id}`, "R", `r${i}-${randomUUID()}`);

  expect((await findMark(parentBody)).childCount).toBe(3);
  const doc = new JSDOM(await html("/")).window.document;
  const link = doc.querySelector(`a[href="/m/${parent.id}"]`);
  expect(link?.textContent).toBe("3 replies");
});

it("the mark page shows a breadcrumb up to the week root and a Find in archive link", async () => {
  const parentBody = `crumb-${randomUUID()}`;
  await post("/", "Crumb", parentBody);
  const parent = await findMark(parentBody);
  const childBody = `crumb-child-${randomUUID()}`;
  await post(`/m/${parent.id}`, "Child", childBody);
  const child = await findMark(childBody);

  const doc = new JSDOM(await html(`/m/${child.id}`)).window.document;
  const crumbs = [...doc.querySelectorAll('nav[aria-label="Breadcrumb"] a')].map((a) => a.getAttribute("href"));
  expect(crumbs).toEqual([`/m/${parent.parentId}`, `/m/${parent.id}`]);
  expect(doc.querySelector(`a[href="/archive/#m-${child.id}"]`)).not.toBeNull();
  expect(doc.querySelector(`form[action="/m/${child.id}"]`)).not.toBeNull();
});

it("posting under a mark that doesn't exist stores nothing", async () => {
  const marker = `ghost-${randomUUID()}`;
  const res = await post("/m/999999999", "Ghost", marker);
  expect(res.status).toBe(404);
  expect((await archive()).marks.some((m) => m.body === marker)).toBe(false);
});

it("404s for unknown and malformed mark ids", async () => {
  expect((await fetch(new URL("/m/999999999", baseUrl))).status).toBe(404);
  expect((await fetch(new URL("/m/abc", baseUrl))).status).toBe(404);
  expect((await fetch(new URL("/m/1.5", baseUrl))).status).toBe(404);
});

it("every page carries a Home/Archive nav with the current one marked", async () => {
  const home = new JSDOM(await html("/")).window.document;
  expect(home.querySelector('nav a[href="/"][aria-current="page"]')).not.toBeNull();
  expect(home.querySelector('nav a[href="/archive/"]')?.hasAttribute("aria-current")).toBe(false);
  const arch = new JSDOM(await html("/archive/")).window.document;
  expect(arch.querySelector('nav a[href="/archive/"][aria-current="page"]')).not.toBeNull();
  expect(arch.querySelector('a[href="/readme/"]')).not.toBeNull();
});

it("/archive/ lists the current week as a nested list without any script", async () => {
  const parentBody = `nested-${randomUUID()}`;
  await post("/", "Nest", parentBody);
  const parent = await findMark(parentBody);
  const childBody = `nested-child-${randomUUID()}`;
  await post(`/m/${parent.id}`, "Nest", childBody);
  const child = await findMark(childBody);
  const { currentWeekId, weeks } = await archive();
  const current = weeks.find((w) => w.id === currentWeekId)!;

  // JSDOM doesn't run scripts by default: this is the page as JS-off sees it.
  const doc = new JSDOM(await html("/archive/")).window.document;
  const week = doc.getElementById(`m-${current.rootMarkId}`);
  expect(week?.tagName).toBe("DETAILS");
  expect(week?.hasAttribute("open")).toBe(true);
  expect(week?.querySelector("summary")?.textContent).toContain(current.label);
  const nested = doc.querySelector(`#m-${parent.id} > ul > #m-${child.id} > a`);
  expect(nested?.getAttribute("href")).toBe(`/m/${child.id}`);
});

it("/archive.json has the tree's shape and never exposes a visitor id", async () => {
  const visitor = randomUUID();
  const marker = `mine-${randomUUID()}`;
  await post("/", "Mine", marker, `visitor=${visitor}`);
  const res = await fetch(new URL("/archive.json", baseUrl), { headers: { Cookie: `visitor=${visitor}` } });
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  const raw = await res.text();
  expect(raw).not.toContain(visitor);
  expect(raw).not.toContain("visitor_id");
  const data = JSON.parse(raw) as Archive;
  expect(data.marks.find((m) => m.body === marker)?.mine).toBe(true);
  expect(data.weeks.length).toBeGreaterThan(0);
  const ids = new Set(data.marks.map((m) => m.id));
  for (const m of data.marks) {
    expect(Object.keys(m)).toEqual(
      expect.arrayContaining(["id", "parentId", "weekId", "name", "body", "createdAt", "childCount", "children"]),
    );
    for (const c of m.children) expect(ids.has(c)).toBe(true);
  }
  // The current week's root tops the tree; its leftmost child is last week's.
  const current = data.weeks.find((w) => w.id === data.currentWeekId)!;
  expect(data.marks.find((m) => m.id === current.rootMarkId)?.parentId).toBeNull();
});

it("rejects a mark with an empty body without storing it", async () => {
  const marker = `empty-${randomUUID()}`;
  await post("/", marker, "");
  expect(await html("/")).not.toContain(marker);
});

it("rejects a name made only of zero-width characters", async () => {
  const marker = `zwsp-${randomUUID()}`;
  await post("/", "\u200b\u200b\u200b", marker);
  expect(await html("/")).not.toContain(marker);
});

it("accepts a name that merely contains a zero-width character", async () => {
  const marker = `zwsp-ok-${randomUUID()}`;
  await post("/", "Jo\u200bhn", marker);
  expect(await html("/")).toContain(marker);
});

it("still serves pages when a cookie value is malformed percent-encoding", async () => {
  for (const path of ["/", "/archive/", "/archive.json"]) {
    const res = await fetch(new URL(path, baseUrl), { headers: { Cookie: "visitor=%" } });
    expect(res.status).toBe(200);
  }
});

it("issues a fresh visitor cookie per anonymous request", async () => {
  const a = await post("/", "A", `a-${randomUUID()}`);
  const b = await post("/", "B", `b-${randomUUID()}`);
  expect(a.headers.get("set-cookie")).toMatch(/^visitor=/);
  expect(b.headers.get("set-cookie")).toMatch(/^visitor=/);
  expect(a.headers.get("set-cookie")).not.toBe(b.headers.get("set-cookie"));
});

it("serves three.js and the client modules with JavaScript content types", async () => {
  const doc = new JSDOM(await html("/archive/")).window.document;
  const map = JSON.parse(doc.querySelector('script[type="importmap"]')!.textContent!) as {
    imports: Record<string, string>;
  };
  for (const path of [map.imports.three, "/static/archive.js"]) {
    const res = await fetch(new URL(path, baseUrl));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/javascript/);
  }
  expect((await fetch(new URL("/static/../package.json", baseUrl))).status).toBe(404);
});
