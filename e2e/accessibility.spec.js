import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { enforceSecurityHeaders, sharedUser, signIn } from "./support.js";

// Automated WCAG 2.2 A/AA checks on every screen, in light and dark themes, plus the keyboard
// behaviour axe can't see. Automated checks find roughly a third of issues; the rest are
// covered by the keyboard tests below and manual review (docs/frontend.md).
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page, label) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(summary, `${label} has accessibility violations`).toEqual([]);
}

test.beforeEach(async ({ context }) => {
  await enforceSecurityHeaders(context, []);
});

for (const colorScheme of ["light", "dark"]) {
  test(`every screen passes axe WCAG 2.2 AA (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const { caseId, intakePath } = sharedUser();

    await page.goto("/login");
    await expectNoViolations(page, "sign in");
    await page.goto("/register");
    await expectNoViolations(page, "register");
    await page.goto("/forgot-password");
    await expectNoViolations(page, "forgot password");
    await page.goto(intakePath);
    await expect(page.getByRole("heading", { name: "Health questionnaire" })).toBeVisible();
    await expectNoViolations(page, "patient intake");

    await signIn(page);
    await expectNoViolations(page, "cases");
    await page.getByRole("link", { name: "Arjun Malhotra" }).first().click();
    await expect(page.getByRole("heading", { name: "Arjun Malhotra", level: 1 })).toBeVisible();
    await expectNoViolations(page, "case");
    await page.goto(`/cases/${caseId}/record`);
    await expect(page.getByRole("heading", { name: "Critical alerts" })).toBeVisible();
    await expectNoViolations(page, "compiled record");
    await page.getByRole("link", { name: /\[S\d+ p\.\d+\]/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoViolations(page, "citation dialog");
  });
}

test("keyboard: skip link, focus after navigation, dialogs contain and return focus", async ({ page }) => {
  await signIn(page);
  await page.goto("/"); // a fresh page load (the session is restored from the refresh cookie)
  await expect(page.getByRole("heading", { name: "Cases", level: 1 })).toBeVisible();

  // first Tab reaches the skip link, which moves focus past the header
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  // client-side navigation puts focus on the new page and gives it a unique title
  await page.getByRole("link", { name: "Arjun Malhotra" }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await expect(page).toHaveTitle("Arjun Malhotra · DocDoc");

  // the delete dialog opens with focus inside, Escape closes it, focus returns to the trigger
  const trigger = page.getByRole("button", { name: "Delete case permanently" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /Delete Arjun Malhotra/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Type the patient name to confirm")).toBeFocused();
  // the page behind is inert: Tab cycles through the dialog and the browser's own UI (body), never
  // reaching the page underneath; the native dialog deliberately lets focus reach browser chrome (no trap, 2.1.2)
  const visited = new Set();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const where = await dialog.evaluate((d) =>
      document.activeElement === document.body ? "browser" : d.contains(document.activeElement) ? document.activeElement.textContent || document.activeElement.tagName : "PAGE"
    );
    visited.add(where);
  }
  expect(visited).not.toContain("PAGE");
  expect(visited).toContain("Cancel");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // Ctrl/Cmd+K jumps to search from anywhere on the cases page
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Cases", level: 1 })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("searchbox", { name: "Search by patient name" })).toBeFocused();
});

const pageOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const screens = () => ["/", `/cases/${sharedUser().caseId}`, `/cases/${sharedUser().caseId}/record`];

// 1.4.10 Reflow: at 320 CSS px (1280px at 400% zoom) nothing but data tables may scroll sideways,
// and those scroll inside their own panel, not the page.
test("content reflows at 320px without the page scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(page);
  for (const path of screens()) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await pageOverflow(page), `${path} scrolls horizontally`).toBeLessThanOrEqual(0);
  }
});

// 1.4.4 Resize text: the browser's text size setting is honoured (sizes are in rem) up to 200%.
test("text resized to 200% stays readable without the page scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  for (const path of screens()) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const before = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize))).toBeCloseTo(before * 2, 0);
    expect(await pageOverflow(page), `${path} scrolls horizontally at 200% text`).toBeLessThanOrEqual(0);
  }
});
