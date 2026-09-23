import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { register } from "../src/modules/auth/auth.service.js";
import { signAccessToken } from "../src/modules/auth/tokens.js";
import { outbox } from "../src/lib/mailer.js";
import { User } from "../src/modules/users/user.model.js";
import { processSource } from "../src/modules/processing/pipeline.js";
import { claimNextSource } from "../src/modules/processing/queue.js";
import { lineModel, pdf } from "./fixtures.js";
import { PASSWORD, useTestDb } from "./helpers.js";

useTestDb();
const app = createApp();
const api = (path) => `/api/v1${path}`;
const tokenOf = (url) => url.split("/intake/")[1];
const drain = async () => {
  let source;
  while ((source = await claimNextSource())) await processSource(source, { chat: lineModel, ai: true });
};

// accounts are made through the real sign-up service; tokens are minted directly because this file
// creates more accounts than the per-IP login rate limit allows (sign-in itself is tested below)
let n = 0;
async function account(accountType, name, { verified = true } = {}) {
  const email = `${accountType}${++n}-${Date.now()}@example.com`;
  const user = await register({ email, name, password: PASSWORD, accountType }, {});
  if (verified) await User.updateOne({ _id: user._id }, { emailVerifiedAt: new Date() });
  return { email, auth: { Authorization: `Bearer ${await signAccessToken(user)}` } };
}
const patientAccount = (name = "Arjun Malhotra", options) => account("patient", name, options);
const verifyLinkFor = (email) => outbox.findLast((m) => m.to === email && m.subject.includes("Confirm"))?.text.match(/verify-email\?token=([\w-]+)/)[1];
const signIn = async () => (await account("doctor", "Test User")).auth;

let DISCHARGE, LABS;
beforeAll(async () => {
  DISCHARGE = await pdf((d) => d.text("Allergies: Penicillin").text("Metformin: 500 mg twice daily"));
  LABS = await pdf((d) => d.text("Hemoglobin: 13.2 g/dL (13.5-17.5)"));
});

describe("patient accounts", () => {
  it("sign up and sign in as a patient", async () => {
    const email = `real-login-${Date.now()}@example.com`;
    await request(app).post(api("/auth/register")).send({ email, name: "Arjun", password: PASSWORD, accountType: "patient" }).expect(201);
    const res = await request(app).post(api("/auth/login")).send({ email, password: PASSWORD }).expect(200);
    expect(res.body.data.user).toMatchObject({ role: "patient", name: "Arjun" });
  });

  it("sign up as a patient through the API and never as an admin", async () => {
    await request(app)
      .post(api("/auth/register"))
      .send({ email: "someone@example.com", name: "X", password: PASSWORD, accountType: "admin" })
      .expect(400);
  });

  it("keeps patients out of doctor endpoints and doctors out of patient endpoints", async () => {
    const patient = await patientAccount();
    const doctor = await signIn();
    await request(app).get(api("/cases")).set(patient.auth).expect(403);
    await request(app).post(api("/cases")).set(patient.auth).send({ patientName: "x" }).expect(403);
    await request(app).get(api("/me/record")).set(doctor).expect(403);
    await request(app).get(api("/me/record")).expect(401);
  });
});

describe("personal health record", () => {
  it("stores uploads, skips documents already in the record, and compiles a cited record", async () => {
    const patient = await patientAccount();
    const first = await request(app).post(api("/me/record/sources")).set(patient.auth).attach("files", DISCHARGE, "discharge.pdf").expect(201);
    expect(first.body.data).toMatchObject({ received: 1, duplicates: [] });

    // the same bytes under another name are a duplicate; a new document is added
    const again = await request(app)
      .post(api("/me/record/sources"))
      .set(patient.auth)
      .attach("files", DISCHARGE, "discharge-copy.pdf")
      .attach("files", LABS, "labs-2025.pdf")
      .expect(201);
    expect(again.body.data).toMatchObject({ received: 1, duplicates: ["discharge-copy.pdf"] });

    await drain();
    const summary = await request(app).get(api("/me/record")).set(patient.auth).expect(200);
    expect(summary.body.data).toMatchObject({ name: "Arjun Malhotra", documents: 2, activeShares: 0 });

    const doc = await request(app).get(api("/me/record/document")).set(patient.auth).expect(200);
    expect(doc.body.data.alerts.allergies[0].label).toBe("Allergies");
    const cite = doc.body.data.alerts.allergies[0].citation;
    const text = await request(app).get(api(`/me/record/sources/${cite.sourceId}/text`)).set(patient.auth).expect(200);
    expect(text.body.data.pages[0].text).toContain("Allergies: Penicillin");
    await request(app).get(api(`/me/record/sources/${cite.sourceId}/file`)).set(patient.auth).expect(200);
  });

  it("each patient sees only their own record", async () => {
    const a = await patientAccount("Patient A");
    const b = await patientAccount("Patient B");
    await request(app).post(api("/me/record/sources")).set(a.auth).attach("files", LABS, "a.pdf").expect(201);
    await drain();
    const aDoc = await request(app).get(api("/me/record/document")).set(a.auth).expect(200);
    const sourceId = aDoc.body.data.sources[0].id;
    // B asking for A's source id through B's own record finds nothing
    await request(app).get(api(`/me/record/sources/${sourceId}/text`)).set(b.auth).expect(404);
    await request(app).get(api(`/me/record/sources/${sourceId}/file`)).set(b.auth).expect(404);
    const bDoc = await request(app).get(api("/me/record/document")).set(b.auth).expect(200);
    expect(bDoc.body.data.sources).toEqual([]);
  });
});

describe("records from a doctor's visit", () => {
  it("opening the doctor's link while signed in copies the visit, and later documents follow", async () => {
    const doctor = await signIn();
    const patient = await patientAccount();
    const { body: c } = await request(app).post(api("/cases")).set(doctor).send({ patientName: "Arjun" }).expect(201);
    await request(app).post(api(`/cases/${c.data.id}/sources`)).set(doctor).attach("files", DISCHARGE, "discharge.pdf").field("note", "BP 150/95 at visit").expect(201);
    await drain();
    const { body: link } = await request(app).post(api(`/cases/${c.data.id}/upload-links`)).set(doctor).expect(201);

    const claimed = await request(app).post(api("/me/links")).set(patient.auth).send({ token: tokenOf(link.data.url) }).expect(200);
    expect(claimed.body.data).toMatchObject({ doctorName: "Test User", copied: 2, share: null });

    let sources = (await request(app).get(api("/me/record/sources")).set(patient.auth).expect(200)).body.data.items;
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => s.fromVisit?.doctorName === "Test User" && s.processing.status === "done")).toBe(true);
    // facts came across with the copy: nothing was re-run through the AI
    const doc = await request(app).get(api("/me/record/document")).set(patient.auth).expect(200);
    expect(doc.body.data.sections.flatMap((s) => s.facts).map((f) => f.label)).toContain("Metformin");

    // a document added to the visit later is mirrored once processed
    await request(app).post(api(`/cases/${c.data.id}/sources`)).set(doctor).attach("files", LABS, "labs.pdf").expect(201);
    await drain();
    sources = (await request(app).get(api("/me/record/sources")).set(patient.auth).expect(200)).body.data.items;
    expect(sources).toHaveLength(3);

    // claiming again copies nothing new; the doctor sees that the case is linked
    const again = await request(app).post(api("/me/links")).set(patient.auth).send({ token: tokenOf(link.data.url) }).expect(200);
    expect(again.body.data.copied).toBe(0);
    const access = await request(app).get(api(`/cases/${c.data.id}/record-access`)).set(doctor).expect(200);
    expect(access.body.data.linkedPatient).toBe(true);

    // deleting the doctor's case leaves the patient's copies intact
    await request(app).delete(api(`/cases/${c.data.id}`)).set(doctor).expect(200);
    const after = await request(app).get(api("/me/record/sources")).set(patient.auth).expect(200);
    expect(after.body.data.total).toBe(3);
    const copy = after.body.data.items.find((s) => s.kind === "file");
    await request(app).get(api(`/me/record/sources/${copy.id}/file`)).set(patient.auth).expect(200);
  });

  it("a link can be linked to one patient account only", async () => {
    const doctor = await signIn();
    const { body: c } = await request(app).post(api("/cases")).set(doctor).send({ patientName: "X" }).expect(201);
    const { body: link } = await request(app).post(api(`/cases/${c.data.id}/upload-links`)).set(doctor).expect(201);
    const first = await patientAccount();
    const second = await patientAccount();
    await request(app).post(api("/me/links")).set(first.auth).send({ token: tokenOf(link.data.url) }).expect(200);
    const res = await request(app).post(api("/me/links")).set(second.auth).send({ token: tokenOf(link.data.url) }).expect(409);
    expect(res.body.error.message).not.toMatch(/patient\d/); // says nothing about who holds it
  });
});

describe("sharing with a doctor", () => {
  async function doctorCase() {
    const doctor = await signIn();
    const { body } = await request(app).post(api("/cases")).set(doctor).send({ patientName: "Arjun" }).expect(201);
    return { doctor, caseId: body.data.id };
  }

  it("a doctor sees nothing until the patient approves, everything once they do, and nothing after revoking", async () => {
    const patient = await patientAccount();
    await request(app).post(api("/me/record/sources")).set(patient.auth).attach("files", DISCHARGE, "history.pdf").expect(201);
    await drain();
    const { doctor, caseId } = await doctorCase();
    const shared = (p) => api(`/cases/${caseId}/shared-record${p}`);

    await request(app).post(api(`/cases/${caseId}/record-access`)).set(doctor).send({ email: patient.email }).expect(201);
    await request(app).get(shared("/document")).set(doctor).expect(404); // pending: nothing visible

    const shares = (await request(app).get(api("/me/shares")).set(patient.auth).expect(200)).body.data;
    expect(shares).toEqual([expect.objectContaining({ status: "pending", requestedBy: "doctor", doctor: { name: "Test User", email: expect.any(String) } })]);
    await request(app).post(api(`/me/shares/${shares[0].id}/approve`)).set(patient.auth).expect(200);

    const doc = await request(app).get(shared("/document")).set(doctor).expect(200);
    expect(doc.body.data.case.patientName).toBe("Arjun Malhotra");
    const sourceId = doc.body.data.sources[0].id;
    await request(app).get(shared(`/sources/${sourceId}/text`)).set(doctor).expect(200);
    await request(app).get(shared(`/sources/${sourceId}/file`)).set(doctor).expect(200);
    await request(app).get(shared("/document/fhir")).set(doctor).expect(200);
    const seen = (await request(app).get(api("/me/shares")).set(patient.auth)).body.data[0];
    expect(seen).toMatchObject({ status: "active" });
    expect(seen.lastAccessedAt).toBeTruthy(); // the patient can see when the doctor last looked

    // another doctor, even with the case id, gets nothing
    const other = await signIn();
    await request(app).get(shared("/document")).set(other).expect(404);
    // the shared record id is not a case id the doctor can open directly
    await request(app).get(api(`/cases/${doc.body.data.case.id}/document`)).set(doctor).expect(404);

    await request(app).post(api(`/me/shares/${shares[0].id}/revoke`)).set(patient.auth).expect(200);
    await request(app).get(shared("/document")).set(doctor).expect(404);
    await request(app).get(shared(`/sources/${sourceId}/file`)).set(doctor).expect(404);
  });

  it("answers the same whether or not the email has a patient account, and waits for sign-up", async () => {
    const { doctor, caseId } = await doctorCase();
    const email = `future-${Date.now()}@example.com`;
    const res = await request(app).post(api(`/cases/${caseId}/record-access`)).set(doctor).send({ email }).expect(201);
    expect(res.body.data).toMatchObject({ status: "pending", patientEmail: email });

    // the patient signs up later with that email, confirms it, and finds the request waiting
    const user = await register({ email, name: "Later Patient", password: PASSWORD, accountType: "patient" }, {});
    const auth = { Authorization: `Bearer ${await signAccessToken(user)}` };
    expect((await request(app).get(api("/me/shares")).set(auth).expect(200)).body.data).toEqual([]); // not before confirming
    await request(app).post(api("/auth/verify-email")).send({ token: verifyLinkFor(email) }).expect(200);
    const [share] = (await request(app).get(api("/me/shares")).set(auth).expect(200)).body.data;
    expect(share.status).toBe("pending");
    await request(app).post(api(`/me/shares/${share.id}/decline`)).set(auth).expect(200);
    await request(app).get(api(`/cases/${caseId}/shared-record/document`)).set(doctor).expect(404);
    const access = await request(app).get(api(`/cases/${caseId}/record-access`)).set(doctor).expect(200);
    expect(access.body.data.share.status).toBe("declined");
  });

  it("a request addressed to an email never reaches an account that hasn't confirmed owning it", async () => {
    // someone signs up with another person's email and never confirms it
    const impostor = await patientAccount("Impostor", { verified: false });
    const { doctor, caseId } = await doctorCase();
    await request(app).post(api(`/cases/${caseId}/record-access`)).set(doctor).send({ email: impostor.email }).expect(201);
    expect((await request(app).get(api("/me/shares")).set(impostor.auth).expect(200)).body.data).toEqual([]);
    // a confirmation link works once
    const token = verifyLinkFor(impostor.email);
    await request(app).post(api("/auth/verify-email")).send({ token }).expect(200);
    await request(app).post(api("/auth/verify-email")).send({ token }).expect(401);
  });

  it("a patient can only answer requests addressed to them", async () => {
    const target = await patientAccount();
    const intruder = await patientAccount();
    const { doctor, caseId } = await doctorCase();
    await request(app).post(api(`/cases/${caseId}/record-access`)).set(doctor).send({ email: target.email }).expect(201);
    const [share] = (await request(app).get(api("/me/shares")).set(target.auth)).body.data;
    expect((await request(app).get(api("/me/shares")).set(intruder.auth)).body.data).toEqual([]);
    await request(app).post(api(`/me/shares/${share.id}/approve`)).set(intruder.auth).expect(404);
  });

  it("one open request per case; the doctor can withdraw and ask again", async () => {
    const { doctor, caseId } = await doctorCase();
    await request(app).post(api(`/cases/${caseId}/record-access`)).set(doctor).send({ email: "a@example.com" }).expect(201);
    await request(app).post(api(`/cases/${caseId}/record-access`)).set(doctor).send({ email: "b@example.com" }).expect(409);
    await request(app).delete(api(`/cases/${caseId}/record-access`)).set(doctor).expect(200);
    await request(app).post(api(`/cases/${caseId}/record-access`)).set(doctor).send({ email: "b@example.com" }).expect(201);
  });

  it("the patient can share straight from their doctor's link", async () => {
    const patient = await patientAccount();
    const { doctor, caseId } = await doctorCase();
    const { body: link } = await request(app).post(api(`/cases/${caseId}/upload-links`)).set(doctor).expect(201);
    await request(app).post(api("/me/links/share")).set(patient.auth).send({ token: tokenOf(link.data.url) }).expect(200);
    await request(app).get(api(`/cases/${caseId}/shared-record/document`)).set(doctor).expect(200);
    const access = await request(app).get(api(`/cases/${caseId}/record-access`)).set(doctor).expect(200);
    expect(access.body.data.share).toMatchObject({ status: "active", requestedBy: "patient" });
    expect(access.body.data.share.patientEmail).toBeUndefined(); // the doctor never typed it
  });
});
