import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { config } from "./config/index.js";
import { connectDb, disconnectDb } from "./lib/db.js";
import { logger } from "./lib/logger.js";
import { counter, registry } from "./lib/metrics.js";
import { aiEnabled } from "./modules/agent/llm.js";
import { stopOcr } from "./modules/processing/ocr.js";
import { processSource } from "./modules/processing/pipeline.js";
import { claimNextSource, recordFailure } from "./modules/processing/queue.js";

// Separate process from the API (bulkhead): slow OCR or a slow AI provider can't starve API requests.
const processed = counter("pipeline_sources_total", "Sources processed", ["outcome"]);

try {
  await connectDb();
} catch (err) {
  logger.fatal({ error: err.name, reason: err.message }, "database connection failed");
  process.exit(1);
}
if (!aiEnabled) logger.warn("NVIDIA_API_KEY unset: documents will be text-extracted but not structured");

const metricsServer = createServer(async (req, res) => {
  if (req.url !== "/metrics") return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": registry.contentType }).end(await registry.metrics());
})
  // metrics are best-effort: a busy port must not stop document processing
  .on("error", (err) => logger.warn({ err: err.message }, "metrics endpoint unavailable"))
  .listen(config.WORKER_METRICS_PORT, config.WORKER_METRICS_HOST);

const running = new Set();
let stopping = false;

async function handle(source) {
  const log = logger.child({ sourceId: String(source._id), attempt: source.processing.attempts });
  try {
    await processSource(source);
    processed.inc({ outcome: "done" });
    log.info("source processed");
  } catch (err) {
    processed.inc({ outcome: "failed" });
    log.error({ err }, "source processing failed");
    await recordFailure(source, err);
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

logger.info({ concurrency: config.WORKER_CONCURRENCY }, "worker started");
// oxlint-disable-next-line no-unmodified-loop-condition -- flipped by the signal handler
while (!stopping) {
  if (running.size >= config.WORKER_CONCURRENCY) {
    await Promise.race(running);
    continue;
  }
  const source = await claimNextSource().catch((err) => logger.error({ err }, "claim failed"));
  if (!source) {
    await sleep(2000);
    continue;
  }
  const job = handle(source).finally(() => running.delete(job));
  running.add(job);
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal, inFlight: running.size }, "worker draining");
  setTimeout(() => process.exit(1), 60_000).unref();
  await Promise.allSettled(running); // unfinished leases would expire anyway, but finish cleanly
  await stopOcr();
  metricsServer.close();
  await disconnectDb();
  process.exit(0);
}
