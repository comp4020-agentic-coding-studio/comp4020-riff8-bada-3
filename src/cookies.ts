import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const raw = part.slice(eq + 1).trim();
    // A stray `%` not followed by two hex digits (hand-edited in devtools, a
    // stale value from a past encoding, a corrupted client) makes
    // decodeURIComponent throw — treat it as absent rather than failing the
    // whole request, which would otherwise 500 every request from that
    // client, including a plain GET /, until they clear cookies by hand.
    try {
      out[part.slice(0, eq).trim()] = decodeURIComponent(raw);
    } catch {
      continue;
    }
  }
  return out;
}

export function getCookie(req: IncomingMessage, name: string): string | undefined {
  return parseCookies(req.headers.cookie)[name];
}

// Throws on a lone surrogate, so callers build it before any write it follows.
export function cookieHeader(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax; HttpOnly`;
}

export function setCookie(res: ServerResponse, name: string, value: string): void {
  res.appendHeader("Set-Cookie", cookieHeader(name, value));
}

const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The one piece of identity this app has: a random id in a first-party
// cookie, issued the first time someone shows up. No accounts, no passwords —
// it only has to tell two visitors apart, not verify who they are.
export function getVisitorId(req: IncomingMessage, res: ServerResponse): string {
  // Only an id this server could have issued counts; anything else (an empty
  // value, "system", a hand-typed string) gets a fresh one.
  const existing = getCookie(req, "visitor");
  if (existing && VISITOR_ID.test(existing)) return existing;
  const id = randomUUID();
  setCookie(res, "visitor", id);
  return id;
}
