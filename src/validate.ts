// What a submitted mark has to be before it's written, since a written mark is
// permanent. Nothing is ever shortened: input over a limit is sent back to be
// fixed, not trimmed to fit.
//
// Lengths are counted the way the browser's `maxlength` counts them, in UTF-16
// code units (`String.length`), so the form's own limit and this one always
// agree: most emoji count as two. A textarea submits line breaks as CRLF but
// counts them as one, so the body's line breaks are normalised to LF first.

export const MAX_NAME = 40;
export const MAX_BODY = 280;

export interface Draft {
  name: string;
  body: string;
}

export type FieldErrors = Partial<Record<keyof Draft, string>>;

export type Validated = { ok: true; draft: Draft } | { ok: false; draft: Draft; errors: FieldErrors };

// `.trim()` only strips whitespace (Unicode `Zs`), not zero-width/format
// characters (`Cf`, e.g. U+200B) — a string made of nothing else survives
// `.trim()` non-empty and reads as blank on the wall.
export function hasVisibleContent(s: string): boolean {
  return /[^\s\p{Cf}]/u.test(s);
}

function check(value: string, max: number, empty: string, noun: string): string | undefined {
  if (!value.isWellFormed()) return `That ${noun} has a broken character in it. Retype it and post again.`;
  if (!hasVisibleContent(value)) return empty;
  if (value.length > max) {
    return `That's ${value.length} characters; a ${noun} can be at most ${max}. Shorten it by ${value.length - max} and post again.`;
  }
  return undefined;
}

export function validateDraft(raw: { name?: string | null; body?: string | null }): Validated {
  const draft = {
    name: (raw.name ?? "").trim(),
    body: (raw.body ?? "").replace(/\r\n?/g, "\n").trim(),
  };
  const errors: FieldErrors = {};
  const name = check(draft.name, MAX_NAME, "Add a name. Anything will do: it's a label, not an account.", "name");
  const body = check(
    draft.body,
    MAX_BODY,
    "Write something first. Spaces or invisible characters on their own don't count.",
    "mark",
  );
  if (name) errors.name = name;
  if (body) errors.body = body;
  return name || body ? { ok: false, draft, errors } : { ok: true, draft };
}

// For logs: the first few characters, never split mid-character.
export function preview(s: string, max = 24): string {
  const chars = [...s.replace(/\s+/g, " ")];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}
