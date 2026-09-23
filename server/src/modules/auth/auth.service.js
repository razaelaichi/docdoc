import { randomBytes, randomUUID } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { config } from "../../config/index.js";
import { accountLocked, invalidCredentials, unauthorized } from "../../lib/errors.js";
import { sendMailInBackground } from "../../lib/mailer.js";
import { recordAudit } from "../audit/audit.service.js";
import * as users from "../users/user.repository.js";
import * as refreshTokens from "./refreshToken.repository.js";
import { hashToken, newRefreshToken, signAccessToken } from "./tokens.js";
import * as userTokens from "./userToken.repository.js";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const RESET_TTL_MINUTES = 60;
const VERIFY_TTL_HOURS = 48;
// verifying against a throwaway hash makes unknown emails take as long as wrong passwords
const DUMMY_HASH = await hash(randomUUID());

async function emailLink(user, purpose, ttlMs, pagePath) {
  const token = randomBytes(32).toString("base64url");
  await userTokens.saveUserToken({
    userId: user._id,
    purpose,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return `${config.PUBLIC_APP_URL}${pagePath}?token=${token}`;
}

// Same response whether or not the email is taken, so sign-up can't be used to probe for accounts.
export async function register({ email, name, password, accountType = "doctor" }, ctx) {
  const passwordHash = await hash(password);
  try {
    const user = await users.createUser({ email, name, passwordHash, role: accountType });
    await recordAudit("auth.register", { actorId: user._id, ...ctx, meta: { role: accountType } });
    await sendVerification(user);
    return user;
  } catch (err) {
    if (err.code !== 11000) throw err;
    sendMailInBackground({
      to: email,
      subject: "DocDoc sign-up attempt",
      text: "Someone tried to create a DocDoc account with this email address, which already has one.\n\nIf this was you, sign in or reset your password. Otherwise you can ignore this email.",
    });
    return null;
  }
}

async function sendVerification(user) {
  sendMailInBackground({
    to: user.email,
    subject: "Confirm your DocDoc email address",
    text: `Hello ${user.name},\n\nConfirm this is your email address:\n${await emailLink(
      user,
      "verify_email",
      VERIFY_TTL_HOURS * 3_600_000,
      "/verify-email"
    )}\n\nThe link expires in ${VERIFY_TTL_HOURS} hours. If you didn't create a DocDoc account, ignore this email.`,
  });
}

export async function resendVerification(userId) {
  const user = await users.findUserById(userId);
  if (user && !user.emailVerifiedAt) await sendVerification(user);
}

export async function verifyEmail(token, ctx) {
  const used = await userTokens.consumeUserToken(hashToken(token), "verify_email");
  if (!used) throw unauthorized("This confirmation link is invalid or has expired");
  await users.markEmailVerified(used.userId);
  await recordAudit("auth.email_verified", { actorId: used.userId, ...ctx });
}

export async function requestPasswordReset(email, ctx) {
  const user = await users.findUserByEmail(email);
  await recordAudit("auth.password_reset.requested", { actorId: user?._id, ...ctx });
  if (!user) return; // same response either way
  sendMailInBackground({
    to: user.email,
    subject: "Reset your DocDoc password",
    text: `Hello ${user.name},\n\nReset your password here:\n${await emailLink(
      user,
      "reset_password",
      RESET_TTL_MINUTES * 60_000,
      "/reset-password"
    )}\n\nThe link expires in ${RESET_TTL_MINUTES} minutes. If you did not ask for this, ignore this email.`,
  });
}

export async function resetPassword(token, password, ctx) {
  const used = await userTokens.consumeUserToken(hashToken(token), "reset_password");
  if (!used) throw unauthorized("This reset link is invalid or has expired");
  await users.setPassword(used.userId, await hash(password));
  await refreshTokens.revokeAllForUser(used.userId); // sign out every existing session
  await recordAudit("auth.password_reset.completed", { actorId: used.userId, ...ctx });
}

export async function login({ email, password }, ctx) {
  const user = await users.findUserForAuth(email);
  const passwordOk = await verify(user?.passwordHash ?? DUMMY_HASH, password);

  if (!user) {
    await recordAudit("auth.login.failure", ctx);
    throw invalidCredentials();
  }
  if (user.lockUntil > new Date()) {
    await recordAudit("auth.login.locked", { actorId: user._id, ...ctx });
    throw accountLocked();
  }
  if (!passwordOk) {
    if ((await users.incrementFailedLogins(user._id)) >= MAX_FAILED_LOGINS) {
      await users.lockUser(user._id, new Date(Date.now() + LOCK_MINUTES * 60_000));
    }
    await recordAudit("auth.login.failure", { actorId: user._id, ...ctx });
    throw invalidCredentials();
  }

  await users.recordLogin(user._id);
  await recordAudit("auth.login.success", { actorId: user._id, ...ctx });
  return { user, ...(await issueTokens(user, randomUUID())) };
}

export async function refresh(rawToken, ctx) {
  const tokenHash = hashToken(rawToken);
  const current = await refreshTokens.consumeRefreshToken(tokenHash);

  if (!current) {
    // a known but already-used token means it was copied: end that whole session
    const known = await refreshTokens.findRefreshToken(tokenHash);
    if (known?.revokedAt) {
      await refreshTokens.revokeFamily(known.familyId);
      await recordAudit("auth.refresh.reuse_detected", { actorId: known.userId, ...ctx });
    }
    throw unauthorized("Session expired, please sign in again");
  }

  const user = await users.findUserById(current.userId); // fresh role, and catches deleted users
  if (!user) throw unauthorized("Session expired, please sign in again");
  return { user, ...(await issueTokens(user, current.familyId)) };
}

export async function logout(rawToken, ctx) {
  const token = rawToken && (await refreshTokens.findRefreshToken(hashToken(rawToken)));
  if (!token) return;
  await refreshTokens.revokeFamily(token.familyId);
  await recordAudit("auth.logout", { actorId: token.userId, ...ctx });
}

async function issueTokens(user, familyId) {
  const refreshToken = newRefreshToken();
  await refreshTokens.saveRefreshToken({
    userId: user._id,
    familyId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  return { accessToken: await signAccessToken(user), refreshToken };
}
