import { Router } from "express";
import { ok } from "../../lib/respond.js";
import { verifyAccessToken } from "../auth/tokens.js";
import { evaluate } from "./flags.js";

export const flagsRouter = Router();

// Signed-in doctors get their rollout bucket; anyone else gets only fully rolled-out flags.
flagsRouter.get("/", async (req, res) => {
  const [scheme, token] = req.headers.authorization?.split(" ") ?? [];
  const user = scheme === "Bearer" && token ? await verifyAccessToken(token).catch(() => null) : null;
  ok(res, evaluate(user?.id));
});
