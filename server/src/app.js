import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config/index.js";
import { metricsMiddleware, registry } from "./lib/metrics.js";
import { limiter } from "./lib/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { v1Router } from "./routes/v1.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", config.TRUST_PROXY); // correct client IP for rate limiting behind a proxy

  app.use(requestLogger);
  app.use(metricsMiddleware);
  app.use(
    helmet({
      // JSON API: nothing should ever render or be framed
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    })
  );
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "Idempotency-Key"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 600,
    })
  );
  app.use(express.json({ limit: "100kb" }));

  app.use("/health", healthRouter);
  // scrape endpoint; restrict to the internal network at the proxy
  app.get("/metrics", async (_req, res) => {
    res.type(registry.contentType).send(await registry.metrics());
  });

  app.use("/api", limiter(15, 300)); // broad per-IP cap; sensitive routes add stricter ones
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store"); // responses carry patient data
    next();
  });
  app.use("/api/v1", v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
