import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { pdf } from "../server/test/fixtures.js";
import { enforceSecurityHeaders, signIn } from "./support.js";

// The patient's side: their own health record, records from a doctor's visit, and sharing with a
// new doctor on the patient's terms. Runs under the production security headers.
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const expectAccessible = async (page, label) => {
  // let entrance animations (toasts fading in) settle; infinite ones (spinners) are ignored
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes[0].target}`), `${label} accessibility`).toEqual([]);
};
const file = async (name, line) => ({ name, mimeType: "application/pdf", buffer: await pdf((d) => d.text(line)) });

test("a patient keeps one health record, gets visit records automatically, and controls who sees it", async ({ browser }) => {
  test.setTimeout(120_000);
  const violations = [];
  const email = `patient.e2e.${Date.now()}@example.com`;

  const patientContext = await browser.newContext();
  await enforceSecurityHeaders(patientContext, violations);
  const patient = await patientContext.newPage();
  const doctorContext = await browser.newContext();
  await enforceSecurityHeaders(doctorContext, violations);
  const doctor = await doctorContext.newPage();

  // --- the patient signs up on the patient pages and adds their history once
  await patient.goto("/patient/register");
  await expectAccessible(patient, "patient sign-up");
  await patient.getByLabel("Name").fill("Priya Raman");
  await patient.getByLabel("Email").fill(email);
  await patient.getByLabel(/Password/).fill("correct horse battery staple");
  await patient.getByRole("button", { name: "Create account" }).click();
  await expect(patient.getByRole("heading", { name: "Your health record", level: 1 })).toBeVisible();
  await expect(patient.getByText("private to you")).toBeVisible();

  // until the email is confirmed, requests addressed to it can't reach this account
  await expect(patient.getByText("Confirm your email address.")).toBeVisible();
  const outbox = await (await fetch("http://localhost:4401")).json(); // the harness's test-only mailbox
  const confirm = outbox.findLast((m) => m.to === email && m.subject.includes("Confirm")).text.match(/verify-email\?token=[\w-]+/)[0];
  await patient.goto(`/${confirm}`);
  await expect(patient.getByText("Your email is confirmed")).toBeVisible();
  await patient.getByRole("link", { name: "Continue" }).click();
  await expect(patient.getByText("Confirm your email address.")).toHaveCount(0);

  const discharge = await file("discharge-2019.pdf", "Allergies: Penicillin");
  await patient.getByLabel("Documents or images").setInputFiles([discharge, await file("labs-2023.pdf", "Hemoglobin: 13.2 g/dL (13.5-17.5)")]);
  await patient.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(patient.getByText("2 documents added to your record")).toBeVisible();

  // only new documents: the same discharge summary again is recognised and skipped
  await patient.getByLabel("Documents or images").setInputFiles([{ ...discharge, name: "discharge-again.pdf" }]);
  await patient.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(patient.getByText("0 documents added; 1 already in your record, skipped")).toBeVisible();
  await expect(patient.getByRole("row", { name: /Ready/ })).toHaveCount(2, { timeout: 30_000 });
  await expectAccessible(patient, "patient dashboard");

  // --- a doctor's visit: the patient opens the doctor's link while signed in
  await signIn(doctor);
  await doctor.getByPlaceholder("New case: patient name").fill("Priya Raman");
  await doctor.getByRole("button", { name: "Create case" }).click();
  await expect(doctor.getByRole("heading", { name: "Priya Raman", level: 1 })).toBeVisible();
  const visitCase = doctor.url();
  await doctor.getByLabel("Documents or images").setInputFiles([await file("ecg-visit.pdf", "Diagnosis: Sinus rhythm")]);
  await doctor.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(doctor.getByText(/\d+ facts/)).toHaveCount(1, { timeout: 30_000 });
  await doctor.getByRole("button", { name: "New upload link" }).click();
  const link = await doctor.getByLabel("Patient upload link").inputValue();

  await patient.goto(link);
  await expect(patient.getByText(/Saved to your health record/)).toBeVisible();
  await patient.getByRole("link", { name: "Open your record" }).click();
  await expect(patient.getByRole("row", { name: /ecg-visit\.pdf/ })).toContainText("Visit with Dr Shared");

  // the doctor sees that the case is linked, but not the patient's other records
  await doctor.goto(visitCase);
  await expect(doctor.getByText("The patient linked this case to their DocDoc account")).toBeVisible();

  // --- a new doctor (a new case) asks for the whole record by email
  await doctor.goto("/");
  await doctor.getByPlaceholder("New case: patient name").fill("Priya Raman (cardiology)");
  await doctor.getByRole("button", { name: "Create case" }).click();
  await expect(doctor.getByRole("heading", { name: "Priya Raman (cardiology)", level: 1 })).toBeVisible();
  const newCase = doctor.url();
  await doctor.getByLabel("Patient's email").fill(email);
  await doctor.getByRole("button", { name: "Request access" }).click();
  await expect(doctor.getByText("Nothing is visible until the patient approves")).toBeVisible();
  await doctor.goto(`${newCase}/shared-record`);
  await expect(doctor.getByRole("alert")).toContainText("has not shared");

  // --- the patient approves after reading exactly what will be shared
  await patient.goto("/patient");
  await patient.getByRole("button", { name: "Review and approve" }).click();
  await expect(patient.getByRole("dialog")).toContainText("3 documents today, and anything you add later");
  await patient.getByRole("button", { name: "Approve access" }).click();
  await expect(patient.getByText("Dr Shared can now see your health record")).toBeVisible();

  // --- the doctor sees the full history straight away: the patient's uploads and the other visit
  await doctor.goto(newCase);
  await doctor.getByRole("button", { name: "Open shared health record" }).click();
  await expect(doctor.getByRole("heading", { name: "Critical alerts" })).toBeVisible();
  const index = doctor.getByRole("region", { name: /Source index/ });
  for (const name of ["discharge-2019.pdf", "labs-2023.pdf", "ecg-visit.pdf"]) await expect(index.getByText(name)).toBeVisible();
  await doctor.getByRole("link", { name: /\[S\d+ p\.\d+\]/ }).first().click();
  await expect(doctor.locator("dialog mark")).toBeVisible();
  await doctor.getByRole("button", { name: "Close" }).click();
  await expectAccessible(doctor, "shared record");

  // --- the patient sees the access, then removes it; the doctor loses it at once
  await patient.reload();
  const access = patient.getByRole("region", { name: /Doctors with access/ });
  await expect(access).toContainText(/last viewed/);
  await access.getByRole("button", { name: "Remove access" }).click();
  await patient.getByRole("dialog").getByRole("button", { name: "Remove access" }).click();
  await expect(patient.getByText("Dr Shared can no longer see your health record")).toBeVisible();
  await doctor.reload();
  await expect(doctor.getByRole("alert")).toContainText("has not shared");

  // --- a patient can't wander into the doctor side
  await patient.goto("/");
  await expect(patient).toHaveURL(/\/patient$/);

  await patientContext.close();
  await doctorContext.close();
  expect(violations).toEqual([]);
});
