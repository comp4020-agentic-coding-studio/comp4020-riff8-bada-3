import type { MarkWithCount, WeekRow } from "./db.ts";
import { weekLabel } from "./week.ts";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const timeFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export const MAX_NAME = 40;
export const MAX_BODY = 280;

export interface PageOptions {
  nav?: "home" | "archive";
  head?: string;
  bodyClass?: string;
}

function navLink(href: string, label: string, current: boolean): string {
  return `<a href="${href}"${current ? ' aria-current="page"' : ""}>${label}</a>`;
}

export function page(title: string, body: string, opts: PageOptions = {}): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font: 1rem/1.5 system-ui, sans-serif;
    max-width: 38rem;
    margin: 0 auto;
    padding: 0 1rem 2rem;
  }
  .site-nav { display: flex; gap: 1.25rem; padding: 1rem 0; margin-bottom: 1rem; }
  .site-nav a { text-decoration: none; padding-bottom: 0.15rem; border-bottom: 2px solid transparent; }
  .site-nav a[aria-current="page"] { font-weight: 600; border-bottom-color: currentColor; }
  .muted, header p { color: color-mix(in srgb, currentColor 65%, transparent); }
  form { display: grid; gap: 0.75rem; margin: 1.5rem 0 2rem; }
  label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
  input, textarea {
    width: 100%;
    font: inherit;
    padding: 0.5rem;
    box-sizing: border-box;
  }
  button {
    font: inherit;
    padding: 0.5rem 1rem;
    width: fit-content;
    cursor: pointer;
  }
  ol.marks { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem; }
  .mark {
    padding: 0.75rem 1rem;
    border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent);
  }
  .mark.mine { border-left-color: currentColor; }
  .mark-body { margin: 0 0 0.35rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  .mark-meta {
    margin: 0;
    font-size: 0.85rem;
    color: color-mix(in srgb, currentColor 65%, transparent);
  }
  .badge {
    display: inline-block;
    font-size: 0.75rem;
    border: 1px solid currentColor;
    border-radius: 1em;
    padding: 0 0.5em;
    margin-left: 0.25em;
  }
  .empty { color: color-mix(in srgb, currentColor 65%, transparent); }
  .notice {
    padding: 0.75rem 1rem;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
    border-radius: 0.4rem;
  }
  .crumbs ol { list-style: none; display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0; margin: 0 0 1rem; font-size: 0.9rem; }
  .crumbs li + li::before { content: "›"; margin-right: 0.4rem; opacity: 0.6; }
  .focus-mark { font-size: 1.2rem; }
  .focus-mark .mark-body { font-size: 1.25rem; }
  .week-nav { display: flex; justify-content: space-between; gap: 1rem; margin: 1rem 0; }
  footer { margin-top: 3rem; font-size: 0.85rem; }
</style>
${opts.head ?? ""}
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ""}>
<nav class="site-nav" aria-label="Main">
  ${navLink("/", "Home", opts.nav === "home")}
  ${navLink("/archive/", "Archive", opts.nav === "archive")}
</nav>
${body}
<footer><a href="/readme/">What this is for</a></footer>
</body>
</html>
`;
}

export function replyCount(n: number): string {
  return n === 1 ? "1 reply" : `${n} replies`;
}

function markItem(mark: MarkWithCount, visitorId: string): string {
  const mine = mark.visitor_id === visitorId;
  return `<li class="mark${mine ? " mine" : ""}">
  <p class="mark-body">${escapeHtml(mark.body)}</p>
  <p class="mark-meta">${escapeHtml(mark.name)} · <time datetime="${escapeHtml(mark.created_at)}">${formatTime(mark.created_at)}</time>${
    mine ? ' <span class="badge">yours</span>' : ""
  } · <a href="/m/${mark.id}">${replyCount(mark.child_count)}</a></p>
</li>`;
}

// A wall: a mark's direct children, newest first.
export function wall(marks: MarkWithCount[], visitorId: string, empty: string): string {
  if (marks.length === 0) return `<p class="empty">${empty}</p>`;
  const items = [...marks].reverse().map((m) => markItem(m, visitorId));
  return `<ol class="marks">\n${items.join("\n")}\n</ol>`;
}

export function postForm(action: string, lastName: string, cta: string, bodyLabel: string): string {
  return `<form method="post" action="${action}">
  <p>
    <label for="name">Your name</label>
    <input id="name" name="name" required maxlength="${MAX_NAME}" autocomplete="name" value="${escapeHtml(lastName)}">
  </p>
  <p>
    <label for="body">${bodyLabel}</label>
    <textarea id="body" name="body" required maxlength="${MAX_BODY}" rows="2"></textarea>
  </p>
  <button type="submit">${cta}</button>
</form>`;
}

export function crumbs(ancestors: MarkWithCount[]): string {
  if (ancestors.length === 0) return "";
  const items = ancestors.map((a) => {
    const label = a.is_root ? a.body : `${a.name}: ${snippet(a.body, 32)}`;
    return `<li><a href="/m/${a.id}">${escapeHtml(label)}</a></li>`;
  });
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.join("")}</ol></nav>`;
}

export function snippet(s: string, max: number): string {
  const line = s.split(/\r?\n/)[0];
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

// The no-JS archive and the screen-reader view: every week newest first, each
// a <details>, every mark a link to its page. Ids match the scene's deep links
// (#m-<id>), and browsers open a closed <details> to reach a fragment.
export function archiveList(
  weeks: WeekRow[],
  byParent: Map<number, MarkWithCount[]>,
  currentWeekId: number,
): string {
  const branch = (parentId: number): string => {
    const kids = byParent.get(parentId) ?? [];
    if (kids.length === 0) return "";
    const items = kids.map(
      (m) =>
        `<li id="m-${m.id}"><a href="/m/${m.id}">${escapeHtml(m.name)}: ${escapeHtml(snippet(m.body, 80))}</a> <span class="muted">${replyCount(m.child_count)}</span>${branch(m.id)}</li>`,
    );
    return `<ul>${items.join("")}</ul>`;
  };
  return weeks
    .map((w) => {
      const count = (byParent.get(w.root_mark_id) ?? []).length;
      const current = w.id === currentWeekId;
      return `<details id="m-${w.root_mark_id}"${current ? " open" : ""}>
<summary><a href="/m/${w.root_mark_id}">${escapeHtml(weekLabel(w.week_start))}</a> <span class="muted">${count === 1 ? "1 mark" : `${count} marks`}${current ? " · this week" : " · sealed"}</span></summary>
${branch(w.root_mark_id) || '<p class="empty">Nobody left a mark this week.</p>'}
</details>`;
    })
    .join("\n");
}
