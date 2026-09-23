// E2E harness: the real API + pipeline on an in-memory replica set, with a deterministic
// stand-in model, plus a test-only outbox endpoint on a separate port (never part of the app).
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { MongoMemoryReplSet } from "mongodb-memory-server";

Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "warn",
  MONGODB_URI: "mongodb://placeholder",
  CORS_ORIGINS: "http://localhost:5180",
  PUBLIC_APP_URL: "http://localhost:5180",
  JWT_ACCESS_SECRET: "e2e-secret-that-is-at-least-32-characters",
  UPLOAD_DIR: path.join(tmpdir(), `docdoc-e2e-${Date.now()}`),
  RATE_LIMIT_SCALE: "10", // many specs sign in from one IP; production limits are unchanged
});

const server = (p) => new URL(`../server/${p}`, import.meta.url).href;
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
const { connectDb } = await import(server("src/lib/db.js"));
await connectDb(replSet.getUri("docdoc"));

const { createApp } = await import(server("src/app.js"));
const { outbox } = await import(server("src/lib/mailer.js"));
const { processSource } = await import(server("src/modules/processing/pipeline.js"));
const { claimNextSource } = await import(server("src/modules/processing/queue.js"));
const { lineModel } = await import(server("test/fixtures.js"));

// ports distinct from the dev defaults (4000/5173) so E2E can run next to a dev session
createApp().listen(4400);
createServer((_req, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(outbox))).listen(4401);

for (;;) {
  const source = await claimNextSource();
  if (source) await processSource(source, { chat: lineModel, ai: true });
  else await sleep(300);
}
