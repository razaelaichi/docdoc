import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { registry } from "../src/lib/metrics.js";
import { evaluate, parseOverrides } from "../src/modules/flags/flags.js";
import { apiRoute, pageRoute, scrub } from "../src/modules/telemetry/routes.js";

const app = createApp();
const metric = async (name) => (await registry.getSingleMetricAsString(name)).split("\n").filter((l) => !l.startsWith("#"));

describe("frontend telemetry", () => {
  it("records vitals, api timings, errors and workflows as bounded metrics", async () => {
    await request(app)
      .post("/api/v1/telemetry")
      .send({
        events: [
          { type: "vital", name: "LCP", value: 1.2, rating: "good", route: "/cases/:id/record" },
          { type: "vital", name: "CLS", value: 0.02, rating: "good", route: "/" },
          { type: "api", method: "GET", route: "/cases/:id/document", status: 200, duration: 0.3 },
          { type: "api", method: "GET", route: "/evil/<script>", status: 500, duration: 0.3 },
          { type: "error", kind: "runtime", message: "boom for dr@example.com", route: "/made-up-page" },
          { type: "workflow", name: "login", outcome: "success" },
          { type: "navigation", phases: { dns: 0.01, tls: 0.02, ttfb: 0.1 } },
        ],
      })
      .expect(204);

    expect((await metric("frontend_web_vital_seconds")).join("\n")).toContain('metric="LCP",route="/cases/:id/record"');
    expect((await metric("frontend_api_request_duration_seconds")).join("\n")).toContain('route="/cases/:id/document"');
    // unknown routes collapse to "other" so clients can't create new time series
    expect((await metric("frontend_api_request_duration_seconds")).join("\n")).toContain('route="other",status="5xx"');
    expect((await metric("frontend_errors_total")).join("\n")).toContain('kind="runtime",route="other"} 1');
    expect((await metric("frontend_workflows_total")).join("\n")).toContain('workflow="login",outcome="success"} 1');
    expect((await metric("frontend_navigation_phase_seconds")).join("\n")).toContain('phase="tls"');
  });

  it("rejects unknown event shapes and oversized batches", async () => {
    await request(app).post("/api/v1/telemetry").send({ events: [{ type: "vital", name: "XSS", value: 1, rating: "good", route: "/" }] }).expect(400);
    await request(app).post("/api/v1/telemetry").send({ events: [{ type: "workflow", name: "login", outcome: "success", extra: 1 }] }).expect(400);
    const many = Array.from({ length: 51 }, () => ({ type: "workflow", name: "login", outcome: "success" }));
    await request(app).post("/api/v1/telemetry").send({ events: many }).expect(400);
  });

  it("accepts CSP reports in both the Reporting API and legacy formats", async () => {
    await request(app)
      .post("/api/v1/telemetry/csp")
      .set("Content-Type", "application/reports+json")
      .send(JSON.stringify([{ type: "csp-violation", body: { effectiveDirective: "script-src-elem", blockedURL: "https://evil.example/x.js" } }]))
      .expect(204);
    await request(app)
      .post("/api/v1/telemetry/csp")
      .set("Content-Type", "application/csp-report")
      .send(JSON.stringify({ "csp-report": { "violated-directive": "made-up-directive", "blocked-uri": "inline" } }))
      .expect(204);
    const lines = (await metric("frontend_csp_violations_total")).join("\n");
    expect(lines).toContain('directive="script-src-elem"} 1');
    expect(lines).toContain('directive="other"} 1');
  });

  it("maps routes to an allowlist and scrubs personal data from messages", () => {
    expect(pageRoute("/cases/:id")).toBe("/cases/:id");
    expect(pageRoute("/cases/123")).toBe("other");
    expect(apiRoute("/cases/:id/sources/:id/text")).toBe("/cases/:id/sources/:id/text");
    expect(apiRoute("/cases/:id/../../etc")).toBe("other");
    expect(scrub("failed for a.b@example.com at /intake/abcDEF123456789012345 id 6ab388c30b5d4ad973843316 phone 98765"))
      .toBe("failed for [email] at /intake/[token] id [id] phone [n]");
  });
});

describe("feature flags", () => {
  it("serves defaults to anonymous visitors", async () => {
    const res = await request(app).get("/api/v1/flags").expect(200);
    expect(res.body.data).toEqual({ "record-contents": true, "intent-prefetch": true, "keyboard-shortcuts": true });
  });

  it("rolls out by a stable per-user bucket and never to anonymous users below 100%", () => {
    const rollouts = { "intent-prefetch": 50, "keyboard-shortcuts": 0 };
    const on = Array.from({ length: 400 }, (_, i) => evaluate(`user-${i}`, rollouts)["intent-prefetch"]).filter(Boolean).length;
    expect(on).toBeGreaterThan(150);
    expect(on).toBeLessThan(250);
    expect(evaluate("user-7", rollouts)).toEqual(evaluate("user-7", rollouts)); // stable across requests
    expect(evaluate(null, rollouts)["intent-prefetch"]).toBe(false);
    expect(evaluate("user-7", rollouts)["keyboard-shortcuts"]).toBe(false);
  });

  it("parses overrides and refuses unknown flags or bad percentages", () => {
    expect(parseOverrides("intent-prefetch=25, keyboard-shortcuts=off")).toEqual({ "intent-prefetch": 25, "keyboard-shortcuts": 0 });
    expect(() => parseOverrides("no-such-flag=on")).toThrow(/invalid entry/);
    expect(() => parseOverrides("intent-prefetch=150")).toThrow(/invalid entry/);
  });
});
