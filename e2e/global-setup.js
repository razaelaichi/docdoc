import { mkdirSync, writeFileSync } from "node:fs";
import { pdf } from "../server/test/fixtures.js";
import { SHARED_USER_FILE } from "./support.js";

// One doctor with one fully processed case, shared by the accessibility, resilience and
// performance specs (sign-up is rate-limited to 5 per hour, as in production).
const API = "http://localhost:4400/api/v1";
const ORIGIN = { Origin: "http://localhost:5180" };

async function call(path, { token, json, form, method = json || form ? "POST" : "GET" } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...ORIGIN, ...(token && { Authorization: `Bearer ${token}` }), ...(json && { "Content-Type": "application/json" }) },
    body: form ?? (json && JSON.stringify(json)),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(body.error)}`);
  return body.data;
}

export default async function globalSetup() {
  const user = { name: "Dr Shared", email: `dr.shared.${Date.now()}@example.com`, password: "correct horse battery staple" };
  await call("/auth/register", { json: user });
  const { accessToken: token } = await call("/auth/login", { json: { email: user.email, password: user.password } });

  const created = await call("/cases", { token, json: { patientName: "Arjun Malhotra" } });
  const form = new FormData();
  const document = await pdf((d) =>
    d.text("Hemoglobin: 13.2 g/dL (13.5-17.5)").text("Penicillin V: 500 mg twice daily").text("Diagnosis: Type 2 diabetes mellitus").addPage().text("Chest X-ray: No acute findings")
  );
  form.append("files", new Blob([document], { type: "application/pdf" }), "discharge-summary.pdf");
  await call(`/cases/${created.id}/sources`, { token, form });

  const link = await call(`/cases/${created.id}/upload-links`, { token, method: "POST" });
  const intakeToken = link.url.split("/intake/")[1];
  await call(`/intake/${intakeToken}/questionnaire`, { json: { allergies: [{ substance: "Penicillin", reaction: "Rash", severity: "severe" }] } });

  // wait for the worker to structure both sources
  for (let i = 0; i < 60; i++) {
    const { items } = await call(`/cases/${created.id}/sources`, { token });
    if (items.every((s) => s.processing?.status === "done")) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  mkdirSync(new URL(".", SHARED_USER_FILE), { recursive: true });
  writeFileSync(SHARED_USER_FILE, JSON.stringify({ ...user, caseId: created.id, intakePath: `/intake/${intakeToken}` }));
}
