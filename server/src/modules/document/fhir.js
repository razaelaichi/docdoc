import { randomUUID } from "node:crypto";

// Maps the compiled document to a FHIR R4 collection Bundle. Values stay as the source wrote them
// (text, not coded); each resource notes its citation, and one Provenance per source links back.
const ISO_DATE = /^\d{4}-\d{2}(-\d{2})?$/;
const OBS_CATEGORY = {
  lab_result: "laboratory",
  vital_sign: "vital-signs",
  imaging_finding: "imaging",
  social_history: "social-history",
};

function resourceFor(f, patient) {
  const code = { text: f.label };
  const subject = { reference: patient };
  switch (f.category) {
    case "allergy":
      return { resourceType: "AllergyIntolerance", patient: subject, code };
    case "medication":
      return {
        resourceType: "MedicationStatement",
        status: "unknown",
        medicationCodeableConcept: code,
        subject,
        ...(f.value && { dosage: [{ text: f.value }] }),
      };
    case "condition":
      return { resourceType: "Condition", subject, code, ...(f.date && { onsetString: f.date }) };
    case "procedure":
      return { resourceType: "Procedure", status: "unknown", subject, code, ...(f.date && { performedString: f.date }) };
    case "immunization":
      return { resourceType: "Immunization", status: "completed", vaccineCode: code, patient: subject, occurrenceString: f.date ?? "unknown" };
    default:
      return {
        resourceType: "Observation",
        status: "final",
        ...(OBS_CATEGORY[f.category] && {
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: OBS_CATEGORY[f.category] }] }],
        }),
        code,
        subject,
        ...(f.value && { valueString: f.value }),
        ...(ISO_DATE.test(f.date ?? "") && { effectiveDateTime: f.date }),
        ...(f.flag && {
          interpretation: [
            { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: f.flag === "below" ? "L" : "H" }] },
          ],
        }),
      };
  }
}

export function toFhirBundle(doc) {
  const urn = () => `urn:uuid:${randomUUID()}`;
  const patient = urn();
  const entries = [{ fullUrl: patient, resource: { resourceType: "Patient", name: [{ text: doc.case.patientName }] } }];

  const documentRefs = new Map();
  for (const s of doc.sources) {
    const url = urn();
    documentRefs.set(s.id, { url, targets: [] });
    entries.push({
      fullUrl: url,
      resource: {
        resourceType: "DocumentReference",
        status: "current",
        identifier: [{ value: s.ref }],
        subject: { reference: patient },
        date: new Date(s.uploadedAt).toISOString(),
        description: s.name,
        content: [{ attachment: { contentType: s.mimeType ?? "text/plain", title: s.name } }],
      },
    });
  }

  for (const f of doc.sections.flatMap((s) => s.facts)) {
    const url = urn();
    const note = [
      `Source ${f.citation.ref} page ${f.citation.page}: "${f.quote}"`,
      f.date && `Date as written: ${f.date}`,
      f.details,
      f.origin === "patient-reported" && "Patient-reported",
    ].filter(Boolean).join("\n");
    entries.push({ fullUrl: url, resource: { ...resourceFor(f, patient), note: [{ text: note }] } });
    documentRefs.get(f.citation.sourceId)?.targets.push({ reference: url });
  }

  for (const { url, targets } of documentRefs.values()) {
    if (!targets.length) continue;
    entries.push({
      fullUrl: urn(),
      resource: {
        resourceType: "Provenance",
        target: targets,
        recorded: doc.generatedAt,
        agent: [{ who: { display: "DocDoc record compiler" } }],
        entity: [{ role: "source", what: { reference: url } }],
      },
    });
  }

  return { resourceType: "Bundle", type: "collection", timestamp: doc.generatedAt, entry: entries };
}
