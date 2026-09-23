import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes.js";
import { caseRouter } from "../modules/cases/case.routes.js";
import { flagsRouter } from "../modules/flags/flags.routes.js";
import { intakeRouter } from "../modules/intake/intake.routes.js";
import { meRouter } from "../modules/records/me.routes.js";
import { telemetryRouter } from "../modules/telemetry/telemetry.routes.js";

export const v1Router = Router();
v1Router.use("/auth", authRouter);
v1Router.use("/cases", caseRouter);
v1Router.use("/intake", intakeRouter);
v1Router.use("/me", meRouter);
v1Router.use("/flags", flagsRouter);
v1Router.use("/telemetry", telemetryRouter);
