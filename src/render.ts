import type { MarkWithCount, WeekRow } from "./db.ts";
import { MAX_BODY, MAX_NAME, type Draft, type FieldErrors } from "./validate.ts";
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

export { MAX_BODY, MAX_NAME } from "./validate.ts";

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
    /* a 40-character name with no spaces must still wrap on a 320px phone */
    overflow-wrap: anywhere;
  }
  .site-nav { display: flex; gap: 1.25rem; padding: 1rem 0; margin-bottom: 1rem; }
  .site-nav a { text-decoration: none; padding-bottom: 0.15rem; border-bottom: 2px solid transparent; }
  .site-nav a[aria-current="page"] { font-weight: 600; border-bottom-color: currentColor; }
  .muted, header p { color: color-mix(in srgb, currentColor 65%, transparent); }
  form { display: grid; gap: 0.75rem; margin: 1.5rem 0 2rem; }
  form p { margin: 0; }
  .hint { display: block; font-size: 0.85rem; color: color-mix(in srgb, currentColor 65%, transparent); }
  .field-error { display: block; font-weight: 600; color: light-dark(#a1121b, #ff8a8f); }
  [aria-invalid="true"] { outline: 2px solid light-dark(#a1121b, #ff8a8f); outline-offset: 1px; }
  .form-errors { padding: 0.5rem 0.75rem; border-left: 4px solid light-dark(#a1121b, #ff8a8f); }
  .form-errors p { margin: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
  .live-status { font-size: 0.8rem; margin: 0 0 0.5rem; color: color-mix(in srgb, currentColor 65%, transparent); }
  .live-status[data-state="live"]::before { content: "● "; color: light-dark(#18794e, #5bd69a); }
  .live-status[data-state="down"] { color: inherit; font-weight: 600; }
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
  .mark.is-new { animation: arrive 1.2s ease-out; }
  @keyframes arrive { from { background: color-mix(in srgb, currentColor 12%, transparent); } }
  @media (prefers-reduced-motion: reduce) { .mark.is-new { animation: none; } }
  .crumbs ol { list-style: none; display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0; margin: 0 0 1rem; font-size: 0.9rem; }
  .crumbs li + li::before { content: "›"; margin-right: 0.4rem; opacity: 0.6; }
  .focus-mark { font-size: 1.2rem; }
  .focus-mark .mark-body { font-size: 1.25rem; }
  .week-nav { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1rem; margin: 1rem 0; }
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

export function markCount(n: number): string {
  return n === 1 ? "1 mark" : `${n} marks`;
}

export function snippet(s: string, max: number): string {
  const line = s.split(/\r?\n/)[0];
  const chars = [...line];
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : line;
}

// The reply-count link's accessible name says whose mark it opens; the
// visible count comes first so the name still contains what's on screen.
// live.js rebuilds it from data-label when the count changes.
function countLabelTail(mark: MarkWithCount, archived: boolean): string {
  return `on ${mark.name}'s mark “${snippet(mark.body, 40)}”, open to ${archived ? "read" : "read and reply"}`;
}

function markItem(mark: MarkWithCount, visitorId: string, archived: boolean): string {
  const mine = mark.visitor_id === visitorId;
  const tail = countLabelTail(mark, archived);
  return `<li class="mark${mine ? " mine" : ""}" data-id="${mark.id}">
  <p class="mark-body">${escapeHtml(mark.body)}</p>
  <p class="mark-meta"><span class="mark-name">${escapeHtml(mark.name)}</span> · <time datetime="${escapeHtml(mark.created_at)}">${formatTime(mark.created_at)}</time>${
    mine ? ' <span class="badge">yours</span>' : ""
  } · <a href="/m/${mark.id}" data-count-for="${mark.id}" data-label="${escapeHtml(tail)}" aria-label="${escapeHtml(`${replyCount(mark.child_count)} ${tail}`)}">${replyCount(mark.child_count)}</a></p>
</li>`;
}

// A wall: a mark's direct children, newest first. live.js adds to it in place.
export function wall(
  parentId: number,
  marks: MarkWithCount[],
  visitorId: string,
  empty: string,
  archived = false,
): string {
  const items = [...marks].reverse().map((m) => markItem(m, visitorId, archived));
  return `<div class="wall" data-wall="${parentId}" data-archived="${archived ? 1 : 0}">
<p class="empty"${marks.length ? " hidden" : ""}>${empty}</p>
<ol class="marks">
${items.join("\n")}
</ol>
</div>`;
}

export interface FormOptions {
  action: string;
  cta: string;
  bodyLabel: string;
  draft?: Draft;
  errors?: FieldErrors;
}

function field(
  id: "name" | "body",
  label: string,
  hint: string,
  error: string | undefined,
  control: (attrs: string) => string,
  focus = false,
): string {
  const describedBy = `${id}-hint${error ? ` ${id}-error` : ""}`;
  const attrs = `id="${id}" name="${id}" required aria-describedby="${describedBy}"${error ? ' aria-invalid="true"' : ""}${focus ? " autofocus" : ""}`;
  return `<p class="field">
    <label for="${id}">${label}</label>
    ${control(attrs)}
    <span class="hint" id="${id}-hint">${hint}</span>${
      error ? `\n    <span class="field-error" id="${id}-error">${escapeHtml(error)}</span>` : ""
    }
  </p>`;
}

// The post/reply form. On a rejected submission it comes back with the draft
// in it, each problem attached to its field, and the first bad field focused.
export function postForm(opts: FormOptions): string {
  const draft = opts.draft ?? { name: "", body: "" };
  const errors = opts.errors ?? {};
  const failed = Object.keys(errors).length > 0;
  return `<form method="post" action="${opts.action}" class="post-form">${
    failed
      ? `\n  <div class="form-errors" role="alert"><p>Not posted yet. ${Object.keys(errors).length === 2 ? "Both fields need" : "One field needs"} a fix; your draft is still here.</p></div>`
      : ""
  }
  ${field("name", "Your name", `Up to ${MAX_NAME} characters. Most emoji count as two.`, errors.name, (a) => `<input ${a} maxlength="${MAX_NAME}" autocomplete="name" value="${escapeHtml(draft.name)}">`, Boolean(errors.name))}
  ${field("body", opts.bodyLabel, `Up to ${MAX_BODY} characters. Once posted it stays: there's no edit or delete.`, errors.body, (a) => `<textarea ${a} maxlength="${MAX_BODY}" rows="3">${escapeHtml(draft.body)}</textarea>`, Boolean(errors.body && !errors.name))}
  <p class="actions"><button type="submit">${opts.cta}</button></p>
</form>`;
}

// Shown by live.js once the page is listening; hidden without JavaScript.
export const liveStatus = `<p class="live-status" role="status" hidden></p>`;

// Root, first mark, and the last few: a deep thread's breadcrumb would
// otherwise fill a phone screen. The parent is always the last link.
const CRUMBS_KEPT = 5;

export function crumbs(ancestors: MarkWithCount[]): string {
  if (ancestors.length === 0) return "";
  const shown: (MarkWithCount | null)[] =
    ancestors.length > CRUMBS_KEPT + 3
      ? [...ancestors.slice(0, 2), null, ...ancestors.slice(-CRUMBS_KEPT)]
      : ancestors;
  const items = shown.map((a) => {
    if (a === null) return `<li class="crumb-gap"><span aria-label="${ancestors.length - 2 - CRUMBS_KEPT} more">…</span></li>`;
    const label = a.is_root ? a.body : `${a.name}: ${snippet(a.body, 32)}`;
    return `<li><a href="/m/${a.id}">${escapeHtml(label)}</a></li>`;
  });
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.join("")}</ol></nav>`;
}

// The no-JS archive and the screen-reader view: every week newest first, each
// a <details>, every mark a link to its page. Ids match the scene's deep links
// (#m-<id>), and browsers open a closed <details> to reach a fragment. Built
// with an explicit stack, not recursion: a thread can be thousands deep.
function branch(rootId: number, byParent: Map<number, MarkWithCount[]>): string {
  const top = byParent.get(rootId) ?? [];
  const out: string[] = ["<ul>"];
  const stack: { kids: MarkWithCount[]; i: number }[] = [{ kids: top, i: 0 }];
  while (stack.length > 0) {
    const f = stack[stack.length - 1];
    if (f.i >= f.kids.length) {
      stack.pop();
      out.push("</ul>");
      if (stack.length > 0) out.push("</li>");
      continue;
    }
    const m = f.kids[f.i++];
    out.push(
      `<li id="m-${m.id}"><a href="/m/${m.id}">${escapeHtml(m.name)}: ${escapeHtml(snippet(m.body, 80))}</a> <span class="muted" data-count-for="${m.id}">${replyCount(m.child_count)}</span>`,
    );
    const kids = byParent.get(m.id) ?? [];
    if (kids.length > 0) {
      out.push("<ul>");
      stack.push({ kids, i: 0 });
    } else {
      out.push("</li>");
    }
  }
  return out.join("");
}

export function weekDetails(w: WeekRow, byParent: Map<number, MarkWithCount[]>, current: boolean): string {
  const count = (byParent.get(w.root_mark_id) ?? []).length;
  return `<details id="m-${w.root_mark_id}" data-week="${w.id}"${current ? " open" : ""}>
<summary><a href="/m/${w.root_mark_id}">${escapeHtml(weekLabel(w.week_start))}</a> <span class="muted"><span data-count-for="${w.root_mark_id}" data-count-format="marks">${markCount(count)}</span><span class="week-state">${current ? " · this week" : " · sealed"}</span></span></summary>
<p class="empty"${count ? " hidden" : ""}>Nobody left a mark this week.</p>
${count ? branch(w.root_mark_id, byParent) : "<ul></ul>"}
</details>`;
}

export function archiveList(
  weeks: WeekRow[],
  byParent: Map<number, MarkWithCount[]>,
  currentWeekId: number,
): string {
  return weeks.map((w) => weekDetails(w, byParent, w.id === currentWeekId)).join("\n");
}
