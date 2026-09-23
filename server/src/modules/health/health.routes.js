import { Router } from "express";
import { dependencyUnavailable } from "../../lib/errors.js";
import { pingDb } from "../../lib/db.js";
import { ok } from "../../lib/respond.js";

export const healthRouter = Router();

healthRouter.get("/live", (_req, res) => ok(res, { status: "ok" }));

healthRouter.get("/ready", async (_req, res) => {
  try {
    await pingDb();
  } catch {
    throw dependencyUnavailable({ database: "down" });
  }
  ok(res, { status: "ok", database: "up" });
});
