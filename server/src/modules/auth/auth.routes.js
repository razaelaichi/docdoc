import cookieParser from "cookie-parser";
import { Router } from "express";
import { z } from "zod";
import { config, isProd } from "../../config/index.js";
import { forbidden, notFound, unauthorized } from "../../lib/errors.js";
import { limiter } from "../../lib/rateLimit.js";
import { ok } from "../../lib/respond.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validate } from "../../middleware/validate.js";
import { toPublicUser } from "../users/user.dto.js";
import { findUserById } from "../users/user.repository.js";
import * as auth from "./auth.service.js";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
// strictObject rejects extra keys, so a client can't slip in e.g. "role": "admin"
const registerBody = z.strictObject({
  email,
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(128), // upper bound keeps hashing cost bounded
  accountType: z.enum(["doctor", "patient"]).default("doctor"), // never "admin"
});
const newPassword = registerBody.shape.password;
const loginBody = z.strictObject({ email, password: z.string().min(1).max(128) });
const emailedToken = z.string().regex(/^[\w-]{20,64}$/, "invalid token");

const COOKIE = "rt";
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "strict",
  path: "/api/v1/auth", // the refresh token is never sent to any other endpoint
};

// cookie-authenticated endpoints: only our own frontend may call them (CSRF defence on top of SameSite)
const trustedOrigin = (req, _res, next) => {
  if (!config.CORS_ORIGINS.includes(req.headers.origin)) throw forbidden("Untrusted origin");
  next();
};

const ctx = (req) => ({ ip: req.ip, requestId: req.id });

function sendSession(res, { user, accessToken, refreshToken }) {
  res.cookie(COOKIE, refreshToken, { ...cookieOptions, maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000 });
  ok(res, { user: toPublicUser(user), accessToken, expiresIn: config.ACCESS_TOKEN_TTL_MIN * 60 });
}

export const authRouter = Router();
authRouter.use(cookieParser());

authRouter.post("/register", limiter(60, 5), validate({ body: registerBody }), async (req, res) => {
  await auth.register(req.valid.body, ctx(req));
  ok(res, null, { status: 201, message: "Account created" });
});

authRouter.post("/forgot-password", limiter(60, 5), validate({ body: z.strictObject({ email }) }), async (req, res) => {
  await auth.requestPasswordReset(req.valid.body.email, ctx(req));
  ok(res, null, { message: "If that email has an account, a reset link is on its way" });
});

authRouter.post(
  "/reset-password",
  limiter(15, 10),
  validate({ body: z.strictObject({ token: emailedToken, password: newPassword }) }),
  async (req, res) => {
    await auth.resetPassword(req.valid.body.token, req.valid.body.password, ctx(req));
    ok(res, null, { message: "Password changed, please sign in" });
  }
);

authRouter.post("/verify-email", limiter(15, 20), validate({ body: z.strictObject({ token: emailedToken }) }), async (req, res) => {
  await auth.verifyEmail(req.valid.body.token, ctx(req));
  ok(res, null, { message: "Email confirmed" });
});

authRouter.post("/verify-email/resend", limiter(60, 5), authenticate, async (req, res) => {
  await auth.resendVerification(req.user.id);
  ok(res, null, { message: "If your email isn't confirmed yet, a new link is on its way" });
});

authRouter.post("/login", limiter(15, 20), validate({ body: loginBody }), async (req, res) => {
  sendSession(res, await auth.login(req.valid.body, ctx(req)));
});

authRouter.post("/refresh", limiter(15, 60), trustedOrigin, async (req, res) => {
  const token = req.cookies[COOKIE];
  if (!token) throw unauthorized();
  try {
    sendSession(res, await auth.refresh(token, ctx(req)));
  } catch (err) {
    res.clearCookie(COOKIE, cookieOptions);
    throw err;
  }
});

authRouter.post("/logout", trustedOrigin, async (req, res) => {
  await auth.logout(req.cookies[COOKIE], ctx(req));
  res.clearCookie(COOKIE, cookieOptions);
  ok(res, null, { message: "Signed out" });
});

authRouter.get("/me", authenticate, async (req, res) => {
  const user = await findUserById(req.user.id);
  if (!user) throw notFound("User not found");
  ok(res, toPublicUser(user));
});
