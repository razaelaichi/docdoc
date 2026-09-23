import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/modules/audit/audit.model.js";
import { outbox } from "../src/lib/mailer.js";
import { register } from "../src/modules/auth/auth.service.js";
import { User } from "../src/modules/users/user.model.js";
import { ORIGIN, PASSWORD as password, useTestDb } from "./helpers.js";

const app = createApp();
useTestDb();

let n = 0;
async function newUser() {
  const email = `doc${++n}@example.com`;
  await register({ email, name: "Dr Test", password }, {}); // service directly: HTTP sign-up is rate-limited
  return email;
}
const login = (email, pw = password) => request(app).post("/api/v1/auth/login").send({ email, password: pw });
const cookieOf = (res) => res.headers["set-cookie"]?.[0].split(";")[0];
const refresh = (cookie, origin = ORIGIN) =>
  request(app).post("/api/v1/auth/refresh").set("Origin", origin).set("Cookie", cookie);

describe("register", () => {
  it("creates a doctor", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "  New@Example.com ", name: "Dr New", password })
      .expect(201);
    const user = await User.findOne({ email: "new@example.com" }).lean();
    expect(user).toMatchObject({ role: "doctor" });
    expect(await AuditLog.countDocuments({ action: "auth.register" })).toBe(1);
  });

  it("rejects unknown fields such as a self-assigned role", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "x@example.com", name: "X", password, role: "admin" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects weak passwords", async () => {
    await request(app).post("/api/v1/auth/register").send({ email: "y@example.com", name: "Y", password: "short" }).expect(400);
  });

  it("answers a duplicate email exactly like a new one, and creates nothing", async () => {
    const email = await newUser();
    const fresh = await request(app).post("/api/v1/auth/register").send({ email: "fresh@example.com", name: "F", password });
    const dup = await request(app).post("/api/v1/auth/register").send({ email: email.toUpperCase(), name: "Dup", password });
    expect(dup.status).toBe(fresh.status);
    expect(dup.body.message).toBe(fresh.body.message);
    expect(await User.countDocuments({ email })).toBe(1);
  });

  it("is rate-limited per IP", async () => {
    let status;
    for (let i = 0; i < 10 && status !== 429; i++) {
      ({ status } = await request(app).post("/api/v1/auth/register").send({ email: `rl${i}@example.com`, name: "RL", password }));
    }
    expect(status).toBe(429);
  });
});

describe("login", () => {
  it("gives the same error for a wrong password and an unknown email", async () => {
    const email = await newUser();
    const wrong = await login(email, "wrong password!!").expect(401);
    const unknown = await login("nobody@example.com").expect(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
  });

  it("rejects NoSQL operator injection", async () => {
    await request(app).post("/api/v1/auth/login").send({ email: { $ne: null }, password: { $ne: null } }).expect(400);
  });

  it("returns an access token and a locked-down refresh cookie", async () => {
    const res = await login(await newUser()).expect(200);
    expect(res.body.data.accessToken).toBeTruthy();
    const setCookie = res.headers["set-cookie"][0];
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Path=\/api\/v1\/auth/);

    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${res.body.data.accessToken}`).expect(200);
    expect(me.body.data.email).toBe(res.body.data.user.email);
  });

  it("locks the account after 5 failed attempts, even for the right password", async () => {
    const email = await newUser();
    for (let i = 0; i < 5; i++) await login(email, "wrong password!!").expect(401);
    const res = await login(email).expect(429);
    expect(res.body.error.code).toBe("ACCOUNT_LOCKED");
  });
});

describe("protected routes", () => {
  it("require a valid bearer token", async () => {
    await request(app).get("/api/v1/auth/me").expect(401);
    await request(app).get("/api/v1/auth/me").set("Authorization", "Bearer not.a.jwt").expect(401);
  });
});

describe("refresh & logout", () => {
  it("rotates the refresh token", async () => {
    const first = cookieOf(await login(await newUser()));
    const res = await refresh(first).expect(200);
    expect(cookieOf(res)).not.toBe(first);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it("revokes the whole session when an old refresh token is replayed", async () => {
    const stolen = cookieOf(await login(await newUser()));
    const current = cookieOf(await refresh(stolen).expect(200));

    await refresh(stolen).expect(401); // replay detected
    expect(await AuditLog.countDocuments({ action: "auth.refresh.reuse_detected" })).toBe(1);
    await refresh(current).expect(401); // legitimate holder is signed out too
  });

  it("refuses cookie endpoints from untrusted origins", async () => {
    const cookie = cookieOf(await login(await newUser()));
    await refresh(cookie, "https://evil.example").expect(403);
  });

  it("logout invalidates the refresh token", async () => {
    const cookie = cookieOf(await login(await newUser()));
    await request(app).post("/api/v1/auth/logout").set("Origin", ORIGIN).set("Cookie", cookie).expect(200);
    await refresh(cookie).expect(401);
  });
});

const linkToken = (mail) => mail.text.match(/token=([\w-]+)/)[1];

describe("password reset", () => {
  it("responds identically for unknown emails and sends nothing", async () => {
    const before = outbox.length;
    const res = await request(app).post("/api/v1/auth/forgot-password").send({ email: "ghost@example.com" }).expect(200);
    expect(res.body.message).toMatch(/if that email has an account/i);
    expect(outbox.length).toBe(before);
  });

  it("sets a new password, burns the link and signs out every session", async () => {
    const email = await newUser();
    const session = cookieOf(await login(email).expect(200));

    await request(app).post("/api/v1/auth/forgot-password").send({ email }).expect(200);
    await new Promise((r) => setTimeout(r, 50)); // email is sent in the background
    const token = linkToken(outbox.findLast((m) => m.to === email));
    const newPassword = "a brand new passphrase";

    await request(app).post("/api/v1/auth/reset-password").send({ token, password: newPassword }).expect(200);
    await request(app).post("/api/v1/auth/reset-password").send({ token, password: newPassword }).expect(401);

    await refresh(session).expect(401);
    await login(email).expect(401); // old password
    await login(email, newPassword).expect(200);
    expect(await AuditLog.countDocuments({ action: "auth.password_reset.completed" })).toBe(1);
  });

  it("rejects a weak new password", async () => {
    await request(app).post("/api/v1/auth/reset-password").send({ token: "x".repeat(40), password: "short" }).expect(400);
  });
});
