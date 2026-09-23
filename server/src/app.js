import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config/index.js";
import { notFound } from "./lib/errors.js";
import { metricsMiddleware, registry } from "./lib/metrics.js";
import { limiter } from "./lib/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { v1Router } from "./routes/v1.js";

function findClientDist() {
  const candidates = [
    process.env.CLIENT_DIST_DIR,
    path.resolve(import.meta.dirname, "../../client/dist"),
    path.resolve(process.cwd(), "../client/dist"),
    path.resolve(process.cwd(), "client/dist"),
    "/app/client/dist",
    "/usr/share/nginx/html",
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) {
      return dir;
    }
  }
  return null;
}

export function createApp() {
  const app = express();
  const clientDist = findClientDist();

  app.set("trust proxy", config.TRUST_PROXY); // correct client IP for rate limiting behind a proxy

  app.use(requestLogger);
  app.use(metricsMiddleware);

  if (clientDist) {
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "blob:", "data:"],
            fontSrc: ["'self'"],
            connectSrc: ["'self'"],
            mediaSrc: ["'none'"],
            objectSrc: ["'none'"],
            frameSrc: ["'none'"],
            workerSrc: ["'none'"],
            manifestSrc: ["'self'"],
            baseUri: ["'none'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
          },
        },
      })
    );
  } else {
    app.use(
      helmet({
        // JSON API: nothing should ever render or be framed
        contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      })
    );
  }

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
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.set("Cache-Control", "no-store"); // responses carry patient data
    next();
  });
  app.use("/api/v1", v1Router);

  if (clientDist) {
    // Hashed build output: cache forever, return 404 if not found (do not fall through to index.html)
    app.use("/assets", express.static(path.join(clientDist, "assets"), { maxAge: "1y", immutable: true }));
    app.use("/assets", (_req, _res, next) => next(notFound("Asset not found")));

    // Other static files (favicon, manifest, fonts)
    app.use(express.static(clientDist, { maxAge: 0 }));

    // SPA client-side routing fallback: serve index.html for non-API GET requests
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/health") || req.path === "/metrics") {
        return next();
      }
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(clientDist, "index.html"), (err) => {
        if (err) next(err);
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
