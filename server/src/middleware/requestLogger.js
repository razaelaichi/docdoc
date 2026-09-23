import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import { logger } from "../lib/logger.js";

const SAFE_ID = /^[\w-]{8,64}$/; // reject client ids that could inject into headers/logs

export const requestLogger = pinoHttp({
  logger,
  genReqId(req, res) {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  customProps: (req) => ({ userId: req.user?.id }), // evaluated when the response finishes
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url.replace(/(\/intake\/)[^/?]+/, "$1[REDACTED]") }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
