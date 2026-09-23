import { rateLimit } from "express-rate-limit";
import { config } from "../config/index.js";
import { rateLimited } from "./errors.js";

// per-IP; in-memory until we run more than one instance (then: Redis store)
export const limiter = (windowMinutes, limit) =>
  rateLimit({
    windowMs: windowMinutes * 60_000,
    limit: limit * config.RATE_LIMIT_SCALE,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(rateLimited()),
  });
