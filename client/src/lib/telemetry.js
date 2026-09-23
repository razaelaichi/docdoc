import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";
import { apiTemplate, pageTemplate, scrub } from "./routes.js";

// Real-user monitoring: batched, sent with sendBeacon so it never blocks the page or an unload.
// Nothing identifying is sent: routes are templates, messages are scrubbed, no user ids.
const ENDPOINT = "/api/v1/telemetry";
const BATCH = 50;
const MAX_ERRORS = 20; // a crash loop must not flood the endpoint

const enabled = import.meta.env.MODE !== "test";
let queue = [];
let timer = null;
let errorCount = 0;

const route = () => pageTemplate(location.pathname);

export function flush() {
  clearTimeout(timer);
  timer = null;
  while (queue.length) {
    const body = JSON.stringify({ events: queue.splice(0, BATCH) });
    const sent = navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }));
    if (!sent) fetch(ENDPOINT, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
  }
}

export function track(event) {
  if (!enabled) return;
  queue.push(event);
  if (queue.length >= BATCH) flush();
  else timer ??= setTimeout(flush, 5000);
}

export function reportError(kind, error, requestId) {
  if (++errorCount > MAX_ERRORS) return;
  const text = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack?.split("\n").slice(1, 3).join("\n") ?? ""}` : String(error);
  track({ type: "error", kind, message: scrub(text), route: route(), ...(requestId && { requestId }) });
}

export function reportApi({ method, path, status, duration, requestId }) {
  if (path.startsWith("/telemetry")) return;
  track({ type: "api", method, route: apiTemplate(path), status, duration: Math.min(duration / 1000, 600), requestId });
}

export const reportWorkflow = (name, outcome) => track({ type: "workflow", name, outcome });

const isChunkError = (message) => /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(message ?? "");

function reportNavigation() {
  const [nav] = performance.getEntriesByType("navigation");
  if (!nav) return;
  const s = (ms) => Math.max(0, ms) / 1000;
  track({
    type: "navigation",
    phases: {
      dns: s(nav.domainLookupEnd - nav.domainLookupStart),
      tcp: s(nav.connectEnd - nav.connectStart),
      tls: s(nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0),
      ttfb: s(nav.responseStart - nav.requestStart),
      download: s(nav.responseEnd - nav.responseStart),
      domInteractive: s(nav.domInteractive - nav.startTime),
    },
  });
}

export function initTelemetry() {
  if (!enabled) return;
  addEventListener("error", (e) => reportError(isChunkError(e.message) ? "chunk-load" : "runtime", e.error ?? e.message));
  addEventListener("unhandledrejection", (e) => reportError(isChunkError(e.reason?.message) ? "chunk-load" : "unhandled-rejection", e.reason));

  const vital = ({ name, value, rating }) =>
    track({ type: "vital", name, value: name === "CLS" ? value : value / 1000, rating, route: route() });
  onLCP(vital);
  onINP(vital);
  onCLS(vital);
  onFCP(vital);
  onTTFB(vital);

  if (document.readyState === "complete") reportNavigation();
  else addEventListener("load", () => setTimeout(reportNavigation), { once: true });

  // the last chance to send: the tab is hidden or being closed
  addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  addEventListener("pagehide", flush);
}
