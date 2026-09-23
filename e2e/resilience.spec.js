import { expect, test } from "@playwright/test";
import { enforceSecurityHeaders, sharedUser, signIn } from "./support.js";

// Failure paths: what the doctor or patient sees when things go wrong, and that it is reported.
test.beforeEach(async ({ context }) => {
  await enforceSecurityHeaders(context, []);
});

test("wrong password is explained without revealing which part was wrong", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(sharedUser().email);
  await page.getByLabel("Password").fill("not-the-password-at-all");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-describedby", "login-error");
});

test("an expired or invalid patient link says so and reveals nothing", async ({ page }) => {
  await page.goto("/intake/this-link-does-not-exist-at-all");
  await expect(page.getByText("This link is invalid or has expired")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
});

test("unknown addresses show a not-found page", async ({ page }) => {
  await signIn(page);
  await page.goto("/no/such/page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("a network failure shows a retryable message, not a blank page", async ({ page }) => {
  // case requests fail from the start; sign-in and the case list are unaffected
  await page.route(/\/api\/v1\/cases\/[a-f\d]{24}$/, (route) => route.abort("internetdisconnected"));
  await signIn(page);
  await page.goto(`/cases/${sharedUser().caseId}`);
  // network errors are retried twice with backoff before the message shows
  await expect(page.getByRole("alert")).toContainText("Could not reach DocDoc", { timeout: 10_000 });
});

test("when the session is revoked the doctor is sent to sign in with an explanation", async ({ page, context }) => {
  await signIn(page);
  // the refresh cookie is gone (signed out elsewhere) and the access token is rejected
  await context.clearCookies();
  await page.route("**/api/v1/cases?*", (route) => route.fulfill({ status: 401, json: { success: false, error: { code: "UNAUTHORIZED", message: "Expired" } } }));
  await page.getByRole("searchbox", { name: "Search by patient name" }).fill("Arjun");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Your session has ended")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("signing out ends the session for good", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  // a direct visit to a patient page after sign-out gets the sign-in page, not cached data
  await page.goto(`/cases/${sharedUser().caseId}/record`);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Arjun Malhotra")).toHaveCount(0);
});

test("errors, web vitals and API timings are reported to the telemetry endpoint", async ({ page }) => {
  const batches = [];
  page.on("request", (req) => req.url().endsWith("/api/v1/telemetry") && batches.push(req.postDataJSON()));
  await signIn(page);
  await page.getByRole("link", { name: "Arjun Malhotra" }).first().click();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); // no-op unless hidden
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide"))); // forces a flush
  await expect.poll(() => batches.flatMap((b) => b.events).map((e) => e.type)).toEqual(expect.arrayContaining(["api", "workflow", "navigation"]));
  const events = batches.flatMap((b) => b.events);
  // identifiers never leave the browser: only route templates
  expect(JSON.stringify(events)).not.toMatch(/[a-f\d]{24}/);
  expect(events.find((e) => e.type === "workflow")).toEqual({ type: "workflow", name: "login", outcome: "success" });
});
