import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { connectDb, disconnectDb } from "../src/lib/db.js";

const app = createApp();

describe("app foundations", () => {
  let mongo;
  afterAll(async () => {
    await disconnectDb();
    await mongo?.stop();
  });

  it("liveness returns the success envelope with a request id", async () => {
    const res = await request(app).get("/health/live").expect(200);
    expect(res.body).toEqual({ success: true, data: { status: "ok" }, requestId: res.headers["x-request-id"] });
  });

  it("echoes a safe client request id and replaces an unsafe one", async () => {
    const safe = await request(app).get("/health/live").set("X-Request-Id", "client-abc-123");
    expect(safe.headers["x-request-id"]).toBe("client-abc-123");
    const unsafe = await request(app).get("/health/live").set("X-Request-Id", "bad id; x");
    expect(unsafe.headers["x-request-id"]).not.toBe("bad id; x");
  });

  it("readiness is 503 until the database is connected, then 200", async () => {
    const down = await request(app).get("/health/ready").expect(503);
    expect(down.body.error.code).toBe("DEPENDENCY_UNAVAILABLE");

    mongo = await MongoMemoryServer.create();
    await connectDb(mongo.getUri());
    await request(app).get("/health/ready").expect(200);
  }, 120_000); // first run downloads the mongod binary

  it("unknown routes return the error envelope", async () => {
    const res = await request(app).get("/api/v1/nope").expect(404);
    expect(res.body).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });

  it("malformed JSON is a 400, not a 500", async () => {
    const res = await request(app).post("/api/v1/x").set("Content-Type", "application/json").send("{bad").expect(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("CORS only allows listed origins", async () => {
    const allowed = await request(app).get("/health/live").set("Origin", "http://localhost:5173");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const blocked = await request(app).get("/health/live").set("Origin", "https://evil.example");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sets security headers", async () => {
    const res = await request(app).get("/health/live");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("exposes prometheus metrics", async () => {
    const res = await request(app).get("/metrics").expect(200);
    expect(res.text).toContain("http_request_duration_seconds");
  });
});
