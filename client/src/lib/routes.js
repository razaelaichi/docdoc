// Route templates for telemetry: ids and upload tokens never leave the browser.
const OBJECT_ID = /^[a-f\d]{24}$/i;

export function pageTemplate(pathname) {
  if (/^\/intake\/[^/]+\/?$/.test(pathname)) return "/intake/:token";
  if (/^\/cases\/[^/]+\/record\/?$/.test(pathname)) return "/cases/:id/record";
  if (/^\/cases\/[^/]+\/shared-record\/?$/.test(pathname)) return "/cases/:id/shared-record";
  if (/^\/cases\/[^/]+\/?$/.test(pathname)) return "/cases/:id";
  const known = ["/", "/login", "/register", "/forgot-password", "/reset-password", "/patient", "/patient/login", "/patient/register", "/patient/record", "/verify-email"];
  return known.includes(pathname) ? pathname : "other";
}

export function apiTemplate(path) {
  const segments = path.split("?")[0].split("/");
  return segments
    .map((s, i) => (segments[i - 1] === "intake" ? ":token" : OBJECT_ID.test(s) ? ":id" : s))
    .join("/");
}

// Same rules as the server's scrubber: no emails, tokens, ids or long numbers in reports.
export const scrub = (text) =>
  String(text)
    .slice(0, 1000)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\/intake\/[^\s/?#"']+/g, "/intake/[token]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[id]")
    .replace(/\d{4,}/g, "[n]");
