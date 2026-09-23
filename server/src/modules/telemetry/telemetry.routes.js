import express, { Router } from "express";
import { z } from "zod";
import { logger } from "../../lib/logger.js";
import { counter, histogram } from "../../lib/metrics.js";
import { limiter } from "../../lib/rateLimit.js";
import { validate } from "../../middleware/validate.js";
import { apiRoute, directive, pageRoute, scrub } from "./routes.js";

// Real-user monitoring from the browser. Unauthenticated (patients on the intake page report too),
// so every label is bounded and every string is scrubbed before it reaches a log or a metric.
const vitalSeconds = histogram("frontend_web_vital_seconds", "Core Web Vitals and paint timings from real users", ["metric", "route"], [0.1, 0.2, 0.5, 0.8, 1, 1.8, 2.5, 4, 6, 10]);
const cls = histogram("frontend_cls", "Cumulative Layout Shift from real users", ["route"], [0.01, 0.05, 0.1, 0.15, 0.25, 0.5, 1]);
const vitalRating = counter("frontend_web_vital_ratings_total", "Web vital ratings (good / needs-improvement / poor)", ["metric", "rating"]);
const navPhase = histogram("frontend_navigation_phase_seconds", "Page load broken down by network phase", ["phase"], [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
const apiDuration = histogram("frontend_api_request_duration_seconds", "API latency as the browser sees it (compare with http_request_duration_seconds)", ["method", "route", "status"], [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]);
const errors = counter("frontend_errors_total", "Frontend errors", ["kind", "route"]);
const workflows = counter("frontend_workflows_total", "User workflows by outcome", ["workflow", "outcome"]);
const cspViolations = counter("frontend_csp_violations_total", "Content-Security-Policy violations", ["directive"]);

const route = z.string().max(100);
const seconds = z.number().min(0).max(600);
const event = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("vital"),
    name: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
    value: z.number().min(0).max(600),
    rating: z.enum(["good", "needs-improvement", "poor"]),
    route,
  }),
  z.strictObject({
    type: z.literal("navigation"),
    phases: z.strictObject({ dns: seconds, tcp: seconds, tls: seconds, ttfb: seconds, download: seconds, domInteractive: seconds }).partial(),
  }),
  z.strictObject({
    type: z.literal("api"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    route,
    status: z.number().int().min(0).max(599), // 0 = network failure or aborted
    duration: seconds,
    requestId: z.string().regex(/^[\w-]{8,64}$/).optional(),
  }),
  z.strictObject({
    type: z.literal("error"),
    kind: z.enum(["runtime", "unhandled-rejection", "render", "chunk-load"]),
    message: z.string().max(1000),
    route,
    requestId: z.string().regex(/^[\w-]{8,64}$/).optional(),
  }),
  z.strictObject({
    type: z.literal("workflow"),
    name: z.enum(["login", "register", "create-case", "upload", "questionnaire", "create-upload-link", "export-pdf", "export-fhir", "delete-case"]),
    outcome: z.enum(["success", "failure"]),
  }),
]);
const batch = z.strictObject({ events: z.array(event).min(1).max(50) });

function record(e) {
  switch (e.type) {
    case "vital":
      if (e.name === "CLS") cls.observe({ route: pageRoute(e.route) }, e.value);
      else vitalSeconds.observe({ metric: e.name, route: pageRoute(e.route) }, e.value);
      vitalRating.inc({ metric: e.name, rating: e.rating });
      break;
    case "navigation":
      for (const [phase, value] of Object.entries(e.phases)) navPhase.observe({ phase }, value);
      break;
    case "api":
      apiDuration.observe({ method: e.method, route: apiRoute(e.route), status: e.status === 0 ? "network" : `${Math.floor(e.status / 100)}xx` }, e.duration);
      break;
    case "error":
      errors.inc({ kind: e.kind, route: pageRoute(e.route) });
      logger.warn({ frontend: { kind: e.kind, route: pageRoute(e.route), message: scrub(e.message), requestId: e.requestId } }, "frontend error");
      break;
    case "workflow":
      workflows.inc({ workflow: e.name, outcome: e.outcome });
      break;
  }
}

export const telemetryRouter = Router();
telemetryRouter.use(limiter(1, 120));

// sendBeacon posts the batch as JSON; nothing is returned but 204
telemetryRouter.post("/", validate({ body: batch }), (req, res) => {
  req.valid.body.events.forEach(record);
  res.status(204).end();
});

// CSP reports: the Reporting API (application/reports+json) and the legacy report-uri format
telemetryRouter.post(
  "/csp",
  express.json({ type: ["application/reports+json", "application/csp-report"], limit: "32kb" }),
  (req, res) => {
    const reports = Array.isArray(req.body) ? req.body.map((r) => r?.body) : [req.body?.["csp-report"]];
    for (const r of reports.slice(0, 20)) {
      if (!r) continue;
      const d = directive(String(r.effectiveDirective ?? r["effective-directive"] ?? r["violated-directive"] ?? "").split(" ")[0]);
      cspViolations.inc({ directive: d });
      logger.warn({ csp: { directive: d, blocked: scrub(r.blockedURL ?? r["blocked-uri"] ?? "") } }, "csp violation");
    }
    res.status(204).end();
  }
);
