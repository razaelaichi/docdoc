import request from "supertest";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { stopOcr } from "../src/modules/processing/ocr.js";
import { processSource } from "../src/modules/processing/pipeline.js";
import { claimNextSource } from "../src/modules/processing/queue.js";
import { lineModel, pdf, textImage } from "./fixtures.js";
import { signIn, useTestDb } from "./helpers.js";

const app = createApp();
useTestDb();
afterAll(stopOcr);

const binary = (res, cb) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

let doctor, caseId, doc;
beforeAll(async () => {
  doctor = await signIn(app);
  caseId = (await request(app).post("/api/v1/cases").set(doctor).send({ patientName: "Maria Lopez" })).body.data.id;
  const token = (await request(app).post(`/api/v1/cases/${caseId}/upload-links`).set(doctor)).body.data.url.split("/intake/")[1];

  const discharge = await pdf((d) =>
    d
      .text("St. Mary Hospital discharge summary")
      .text("Hemoglobin: 13.2 g/dL (13.5-17.5)")
      .text("Penicillin V: 500 mg twice daily")
      .text("Allergies: No known allergies")
      .addPage()
      .text("Chest X-ray: No acute cardiopulmonary findings")
  );
  await request(app)
    .post(`/api/v1/intake/${token}/sources`)
    .attach("files", discharge, "discharge.pdf")
    .attach("files", textImage(["X-RAY CHEST PA"]), "xray.png")
    .expect(201);
  await request(app)
    .post(`/api/v1/intake/${token}/questionnaire`)
    .send({ allergies: [{ substance: "Penicillin", reaction: "Hives", severity: "severe" }] })
    .expect(201);

  let source;
  while ((source = await claimNextSource())) await processSource(source, { chat: lineModel, ai: true });

  doc = (await request(app).get(`/api/v1/cases/${caseId}/document`).set(doctor).expect(200)).body.data;
}, 120_000);

describe("compiled document", () => {
  it("numbers sources in upload order and cites every fact", () => {
    expect(doc.sources.map((s) => [s.ref, s.name])).toEqual([
      ["S1", "discharge.pdf"],
      ["S2", "xray.png"],
      ["S3", "Patient questionnaire"],
    ]);
    const lab = doc.sections.find((s) => s.key === "lab_result").facts[0];
    expect(lab).toMatchObject({
      label: "Hemoglobin",
      value: "13.2 g/dL (13.5-17.5)",
      citation: { ref: "S1", page: 1, quote: "Hemoglobin: 13.2 g/dL (13.5-17.5)" },
    });
  });

  it("puts allergies first and marks patient-reported ones", () => {
    expect(doc.alerts.allergies.map((a) => [a.label, a.origin])).toEqual(
      expect.arrayContaining([["Penicillin", "patient-reported"], ["Allergies", "document"]])
    );
  });

  it("flags conflicts as annotations that point at the facts", () => {
    const kinds = doc.alerts.conflicts.map((c) => c.kind).sort();
    expect(kinds).toEqual(["allergy_denial", "drug_allergy"]);
    const drug = doc.alerts.conflicts.find((c) => c.kind === "drug_allergy");
    const ids = doc.sections.flatMap((s) => s.facts).map((f) => f.id);
    expect(drug.factIds.every((id) => ids.includes(id))).toBe(true);
  });

  it("flags lab values outside the printed reference range", () => {
    expect(doc.alerts.abnormalLabs).toEqual([expect.objectContaining({ label: "Hemoglobin", flag: "below" })]);
  });

  it("attaches uploaded images and cited PDF pages to imaging", () => {
    const imaging = doc.sections.find((s) => s.key === "imaging_finding");
    expect(imaging.images).toEqual([expect.objectContaining({ ref: "S2", name: "xray.png" })]);
    expect(imaging.renderedPages).toEqual([expect.objectContaining({ ref: "S1", page: 2 })]);
  });

  it("reports nothing as incomplete once everything is processed", () => {
    expect(doc.completeness).toEqual({ pending: [], failed: [], notStructured: [] });
  });

  it("serves the full source text behind a citation", async () => {
    const res = await request(app).get(`/api/v1/cases/${caseId}/sources/${doc.sources[0].id}/text`).set(doctor).expect(200);
    expect(res.body.data.pages[1].text).toContain("Chest X-ray");
  });

  it("is invisible to other doctors", async () => {
    const other = await signIn(app);
    await request(app).get(`/api/v1/cases/${caseId}/document`).set(other).expect(404);
    await request(app).get(`/api/v1/cases/${caseId}/document/pdf`).set(other).expect(404);
    await request(app).get(`/api/v1/cases/${caseId}/sources/${doc.sources[0].id}/text`).set(other).expect(404);
  });
});

describe("exports", () => {
  it("renders a PDF with alerts, quotes, embedded images and the full-text appendix", async () => {
    const res = await request(app).get(`/api/v1/cases/${caseId}/document/pdf`).set(doctor).buffer(true).parse(binary).expect(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/^attachment/);

    const pdfDoc = await getDocumentProxy(new Uint8Array(res.body));
    const { text } = await extractText(pdfDoc, { mergePages: true });
    for (const expected of ["Maria Lopez", "Critical alerts", "Hemoglobin: 13.2 g/dL (13.5-17.5)", "[S1 p.1]", "Appendix", "St. Mary Hospital discharge summary"]) {
      expect(text).toContain(expected);
    }
    const page = await pdfDoc.getPage(1);
    expect(pdfDoc.numPages).toBeGreaterThan(1);
    expect(page).toBeTruthy();
  });

  it("exports a FHIR R4 bundle with provenance back to each source", async () => {
    const res = await request(app).get(`/api/v1/cases/${caseId}/document/fhir`).set(doctor).expect(200);
    const bundle = JSON.parse(res.text);
    expect(bundle).toMatchObject({ resourceType: "Bundle", type: "collection" });
    const byType = Object.groupBy(bundle.entry.map((e) => e.resource), (r) => r.resourceType);
    expect(byType.Patient).toHaveLength(1);
    expect(byType.DocumentReference).toHaveLength(3);
    expect(byType.AllergyIntolerance.map((a) => a.code.text).sort()).toEqual(["Allergies", "Penicillin"]);
    expect(byType.MedicationStatement[0]).toMatchObject({ status: "unknown", dosage: [{ text: "500 mg twice daily" }] });
    expect(byType.Observation.find((o) => o.code.text === "Hemoglobin").interpretation[0].coding[0].code).toBe("L");

    const cited = new Set(byType.Provenance.flatMap((p) => p.target.map((t) => t.reference)));
    const clinical = bundle.entry.filter((e) => !["Patient", "DocumentReference", "Provenance"].includes(e.resource.resourceType));
    expect(clinical.every((e) => cited.has(e.fullUrl))).toBe(true);
    expect(clinical.every((e) => e.resource.note[0].text.startsWith("Source S"))).toBe(true);
  });
});
