// Allowlisted route templates. Metric labels must come from a closed set, or a client could
// create unbounded time series; anything else is recorded as "other".
export const PAGE_ROUTES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/intake/:token",
  "/cases/:id",
  "/cases/:id/record",
  "/cases/:id/shared-record",
  "/patient",
  "/patient/login",
  "/patient/register",
  "/patient/record",
  "/verify-email",
];

const API_ROUTE =
  /^\/(auth\/(login|logout|refresh|register|forgot-password|reset-password|verify-email(\/resend)?|me)|cases(\/:id(\/(sources(\/:id(\/(file|text|reprocess))?)?|upload-links(\/:id)?|document(\/(pdf|fhir))?|record-access|shared-record\/(document(\/(pdf|fhir))?|sources\/:id\/(file|text))))?)?|intake\/:token(\/(sources|questionnaire))?|me\/(record(\/(sources(\/:id\/(file|text))?|questionnaire|document(\/(pdf|fhir))?))?|links(\/share)?|shares(\/:id\/(approve|decline|revoke))?)|flags)$/;

export const pageRoute = (route) => (PAGE_ROUTES.includes(route) ? route : "other");
export const apiRoute = (route) => (API_ROUTE.test(route) ? route : "other");

const DIRECTIVES = new Set([
  "default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem", "style-src-attr",
  "img-src", "font-src", "connect-src", "media-src", "object-src", "frame-src", "worker-src", "manifest-src",
  "form-action", "frame-ancestors", "base-uri", "require-trusted-types-for", "trusted-types",
]);
export const directive = (d) => (DIRECTIVES.has(d) ? d : "other");

// Error text can carry user data (a typed name inside a message, a token in a URL): strip the usual suspects.
export const scrub = (text) =>
  String(text)
    .slice(0, 300)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\/intake\/[^\s/?#"']+/g, "/intake/[token]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[id]")
    .replace(/\d{4,}/g, "[n]");
