import { expect, test } from "@playwright/test";
import { pdf } from "../server/test/fixtures.js";
import { enforceSecurityHeaders } from "./support.js";

const email = `dr.e2e.${Date.now()}@example.com`;
const password = "correct horse battery staple";

test("doctor collects records from a patient and reviews the compiled, cited record", async ({ page, context, browser }) => {
  const cspViolations = [];
  await enforceSecurityHeaders(context, cspViolations);

  // --- doctor signs up
  await page.goto("/register");
  await page.getByLabel("Name").fill("Dr E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // --- creates a case and a patient upload link
  await page.getByPlaceholder("New case: patient name").fill("Maria Lopez");
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByRole("heading", { name: "Maria Lopez" })).toBeVisible();
  await page.getByRole("button", { name: "New upload link" }).click();
  const linkField = page.getByLabel("Patient upload link");
  await expect(linkField).toHaveValue(/\/intake\//);
  const uploadLink = await linkField.inputValue();

  // the access token lives in memory only
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);

  // --- patient, in a separate browser with no session, uploads a document and answers the questionnaire
  const patientContext = await browser.newContext();
  await enforceSecurityHeaders(patientContext, cspViolations);
  const patient = await patientContext.newPage();
  await patient.goto(uploadLink);
  await expect(patient.getByText("Maria")).toHaveCount(0); // the link reveals nothing about the patient
  await patient.locator('input[type="file"]').setInputFiles({
    name: "discharge.pdf",
    mimeType: "application/pdf",
    buffer: await pdf((d) =>
      d.text("Hemoglobin: 13.2 g/dL (13.5-17.5)").text("Penicillin V: 500 mg twice daily").addPage().text("Chest X-ray: No acute findings")
    ),
  });
  await patient.getByRole("button", { name: "Upload" }).click();
  await expect(patient.getByText("we received 1 item(s)")).toBeVisible();

  await patient.getByPlaceholder("Substance (e.g. penicillin)").fill("Penicillin");
  await patient.getByLabel("Severity").selectOption("severe");
  await patient.getByRole("button", { name: "Send answers" }).click();
  await expect(patient.getByText("your answers were received")).toBeVisible();
  await patientContext.close();

  // --- doctor sees the sources get processed, then opens the compiled record
  await page.reload();
  await expect(page.getByText(/\d+ facts/)).toHaveCount(2, { timeout: 30_000 });
  await page.getByRole("button", { name: "Open compiled record" }).click();

  await expect(page.getByRole("heading", { name: "Critical alerts" })).toBeVisible();
  await expect(page.getByText('Medication "Penicillin V" matches recorded allergy "Penicillin" (analyser)')).toBeVisible();
  await expect(page.getByText("below printed range (analyser)")).toBeVisible();

  // --- every citation opens the source page with the quote highlighted
  await page.getByRole("row", { name: /Hemoglobin/ }).getByRole("link", { name: "[S1 p.1]" }).click();
  await expect(page.locator("dialog mark")).toHaveText("Hemoglobin: 13.2 g/dL (13.5-17.5)");
  await page.getByRole("button", { name: "Close" }).click();

  // --- exports
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);

  // --- sign out clears the session
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  expect(cspViolations).toEqual([]); // the whole journey ran under the production CSP
});
