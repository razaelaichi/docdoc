import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { connectDb, disconnectDb } from "./lib/db.js";
import { logger } from "./lib/logger.js";

try {
  await connectDb();
} catch (err) {
  // the driver's error carries the whole cluster topology; log only what's actionable
  logger.fatal({ error: err.name, reason: err.message }, "database connection failed");
  process.exit(1);
}
logger.info("database connected");

const server = createApp().listen(config.PORT, () => logger.info({ port: config.PORT }, "server listening"));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  setTimeout(() => process.exit(1), 10_000).unref(); // hard stop if draining hangs
  server.close(async () => {
    await disconnectDb();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (err) => {
  logger.fatal({ err }, "unhandled rejection");
  shutdown("unhandledRejection");
});
