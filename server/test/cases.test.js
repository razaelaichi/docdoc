import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { AuditLog } from "../src/modules/audit/audit.model.js";
import { UploadLink } from "../src/modules/cases/uploadLink.model.js";
import { Source } from "../src/modules/sources/source.model.js";
import { signIn, useTestDb } from "./helpers.js";

const app = createApp();
useTestDb();

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

let doctor, otherDoctor, admin;
beforeAll(async () => {
  [doctor, otherDoctor, admin] = [await signIn(app), await signIn(app), await signIn(app, "admin")];
});

const createCase = (auth, patientName = "Jane Roe", headers = {}) =>
  request(app).post("/api/v1/cases").set(auth).set(headers).send({ patientName });
const newLink = async (auth, caseId) =>
  (await request(app).post(`/api/v1/cases/${caseId}/upload-links`).set(auth).expect(201)).body.data;
const tokenOf = (url) => url.split("/intake/")[1];

describe("cases", () => {
  it("creates a case owned by the doctor", async () => {
    const res = await createCase(doctor).expect(201);
    expect(res.body.data).toMatchObject({ patientName: "Jane Roe" });
    expect(res.body.data.ownerId).toBeUndefined(); // DTO exposes only what the client needs
  });

  it("is idempotent with an Idempotency-Key", async () => {
    const headers = { "Idempotency-Key": "create-case-abc123" };
    const first = await createCase(doctor, "Idem Patient", headers).expect(201);
    const retry = await createCase(doctor, "Idem Patient", headers).expect(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
  });

  it("lists only the caller's cases, with search and pagination", async () => {
    const auth = await signIn(app);
    for (const name of ["Alice Smith", "Bob Jones", "Alicia Keys"]) await createCase(auth, name).expect(201);
    await createCase(otherDoctor, "Alice Other").expect(201);

    const res = await request(app).get("/api/v1/cases?search=ali&sort=patientName&limit=1").set(auth).expect(200);
    expect(res.body.data).toMatchObject({ total: 2, totalPages: 2, page: 1, limit: 1 });
    expect(res.body.data.items[0].patientName).toBe("Alice Smith");
  });

  it("treats regex characters in search literally", async () => {
    await request(app).get("/api/v1/cases?search=.*(").set(doctor).expect(200);
  });

  it("rejects unknown sort fields", async () => {
    await request(app).get("/api/v1/cases?sort=passwordHash").set(doctor).expect(400);
  });

  it("hides other doctors' cases as not found", async () => {
    const { id } = (await createCase(doctor).expect(201)).body.data;
    await request(app).get(`/api/v1/cases/${id}`).set(otherDoctor).expect(404);
    await request(app).post(`/api/v1/cases/${id}/upload-links`).set(otherDoctor).expect(404);
  });

  it("does not give admins access to patient data", async () => {
    await request(app).get("/api/v1/cases").set(admin).expect(403);
  });

  it("requires authentication", async () => {
    await request(app).get("/api/v1/cases").expect(401);
  });
});

describe("patient upload links", () => {
  it("lets a patient upload files and a note, which the doctor can then see and download", async () => {
    const { id } = (await createCase(doctor).expect(201)).body.data;
    const link = await newLink(doctor, id);
    expect(link.url).toMatch(/^http:\/\/localhost:5173\/intake\/[\w-]+$/);

    const info = await request(app).get(`/api/v1/intake/${tokenOf(link.url)}`).expect(200);
    expect(info.body.data).toEqual({ expiresAt: link.expiresAt }); // nothing about the patient

    const up = await request(app)
      .post(`/api/v1/intake/${tokenOf(link.url)}/sources`)
      .attach("files", PDF, { filename: "blood-report.pdf", contentType: "application/pdf" })
      .attach("files", PNG, { filename: "xray.png", contentType: "image/png" })
      .field("note", "Allergic to penicillin")
      .expect(201);
    expect(up.body.data).toEqual({ received: 3, duplicates: [] });

    const list = await request(app).get(`/api/v1/cases/${id}/sources`).set(doctor).expect(200);
    expect(list.body.data.items.map((s) => s.kind).sort()).toEqual(["file", "file", "note"]);
    const pdf = list.body.data.items.find((s) => s.file?.name === "blood-report.pdf");
    expect(pdf.file.mimeType).toBe("application/pdf");

    const dl = await request(app).get(`/api/v1/cases/${id}/sources/${pdf.id}/file`).set(doctor).expect(200);
    expect(dl.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(dl.headers["cache-control"]).toBe("no-store");
    expect(Buffer.from(dl.body).equals(PDF)).toBe(true);
    expect(await AuditLog.countDocuments({ action: "source.download" })).toBe(1);

    await request(app).get(`/api/v1/cases/${id}/sources/${pdf.id}/file`).set(otherDoctor).expect(404);
  });

  it("detects the real file type and rejects disguised files", async () => {
    const { id } = (await createCase(doctor).expect(201)).body.data;
    const res = await request(app)
      .post(`/api/v1/intake/${tokenOf((await newLink(doctor, id)).url)}/sources`)
      .attach("files", Buffer.from("<script>alert(1)</script>"), { filename: "report.pdf", contentType: "application/pdf" })
      .expect(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("stores a re-uploaded file only once", async () => {
    const { id } = (await createCase(doctor).expect(201)).body.data;
    const url = `/api/v1/cases/${id}/sources`;
    await request(app).post(url).set(doctor).attach("files", PDF, "a.pdf").expect(201);
    const again = await request(app).post(url).set(doctor).attach("files", PDF, "copy.pdf").expect(201);
    expect(again.body.data.duplicates).toEqual(["copy.pdf"]);
  });

  it("rejects an empty upload", async () => {
    const { id } = (await createCase(doctor).expect(201)).body.data;
    await request(app).post(`/api/v1/cases/${id}/sources`).set(doctor).field("note", "   ").expect(400);
  });

  it("stops working once revoked", async () => {
    const { id } = (await createCase(doctor).expect(201)).body.data;
    const link = await newLink(doctor, id);
    await request(app).delete(`/api/v1/cases/${id}/upload-links/${link.id}`).set(doctor).expect(200);
    await request(app).get(`/api/v1/intake/${tokenOf(link.url)}`).expect(404);

    const links = await request(app).get(`/api/v1/cases/${id}/upload-links`).set(doctor).expect(200);
    expect(links.body.data[0]).toMatchObject({ id: link.id, active: false });
    expect(links.body.data[0].url).toBeUndefined(); // raw token is never returned again
  });

  it("accepts a structured questionnaire and shows it to the doctor", async () => {
    const { id } = (await createCase(doctor).expect(201)).body.data;
    const token = tokenOf((await newLink(doctor, id)).url);
    await request(app)
      .post(`/api/v1/intake/${token}/questionnaire`)
      .send({
        allergies: [{ substance: "Penicillin", reaction: "Hives", severity: "severe" }],
        medications: [{ name: "Metformin", dose: "500 mg", frequency: "twice daily" }],
        conditions: ["Type 2 diabetes"],
      })
      .expect(201);

    const list = await request(app).get(`/api/v1/cases/${id}/sources`).set(doctor).expect(200);
    expect(list.body.data.items[0]).toMatchObject({
      kind: "questionnaire",
      uploadedBy: "patient",
      questionnaire: { allergies: [{ substance: "Penicillin", severity: "severe" }], surgeries: [] },
    });
  });

  it("rejects an empty or malformed questionnaire", async () => {
    const { id } = (await createCase(doctor).expect(201)).body.data;
    const url = `/api/v1/intake/${tokenOf((await newLink(doctor, id)).url)}/questionnaire`;
    await request(app).post(url).send({}).expect(400);
    await request(app).post(url).send({ allergies: [{ substance: "X", severity: "deadly" }] }).expect(400);
    await request(app).post(url).send({ conditions: ["x"], isAdmin: true }).expect(400);
  });

  it("rejects unknown tokens", async () => {
    await request(app).get(`/api/v1/intake/${"x".repeat(32)}`).expect(404);
  });
});

describe("case deletion", () => {
  it("removes the case, its sources, links and stored files, and audits it", async () => {
    const { id } = (await createCase(doctor, "To Delete").expect(201)).body.data;
    const link = await newLink(doctor, id);
    await request(app).post(`/api/v1/intake/${tokenOf(link.url)}/sources`).attach("files", PNG, "scan.png").expect(201);
    const { file } = await Source.findOne({ caseId: id }).lean();
    const stored = path.resolve(process.env.UPLOAD_DIR, file.storageKey);
    expect(existsSync(stored)).toBe(true);

    await request(app).delete(`/api/v1/cases/${id}`).set(otherDoctor).expect(404); // not theirs
    await request(app).delete(`/api/v1/cases/${id}`).set(doctor).expect(200);

    await request(app).get(`/api/v1/cases/${id}`).set(doctor).expect(404);
    expect(await Source.countDocuments({ caseId: id })).toBe(0);
    expect(await UploadLink.countDocuments({ caseId: id })).toBe(0);
    expect(existsSync(stored)).toBe(false);
    expect(await AuditLog.findOne({ action: "case.delete" }).lean()).toMatchObject({ meta: { sources: 1, uploadLinks: 1, files: 1 } });
  });
});
