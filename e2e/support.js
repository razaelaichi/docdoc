import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";

// The gateway's production headers (CSP with Trusted Types, HSTS, COOP/CORP, ...), read from
// the file nginx includes, so the tests can't drift from what production serves.
export const SECURITY_HEADERS = Object.fromEntries(
  [...readFileSync(new URL("../deploy/security-headers.conf", import.meta.url), "utf8").matchAll(/^add_header ([\w-]+) (["'])(.+)\2 always;/gm)].map(
    ([, name, , value]) => [name.toLowerCase(), value]
  )
);
export const CSP = SECURITY_HEADERS["content-security-policy"];

export const SHARED_USER_FILE = new URL("../test-results/e2e-shared.json", import.meta.url);
export const sharedUser = () => JSON.parse(readFileSync(SHARED_USER_FILE, "utf8"));

// Serves every app response with the production headers and records any CSP violation.
export async function enforceSecurityHeaders(context, violations) {
  await context.route("http://localhost:5180/**", async (route) => {
    try {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), ...SECURITY_HEADERS } });
    } catch (err) {
      // a beacon sent on pagehide can outlive its page or context; anything else is a real failure
      if (!/Test ended|closed|Target page, context or browser has been closed/i.test(err.message)) throw err;
    }
  });
  context.on("console", (msg) => /Content Security Policy|Trusted Type/i.test(msg.text()) && violations.push(msg.text()));
}

export async function signIn(page, { email, password } = sharedUser()) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Cases", level: 1 })).toBeVisible();
}
