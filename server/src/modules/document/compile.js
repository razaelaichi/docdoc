import { AppError } from "../../lib/errors.js";
import { Fact } from "../processing/fact.model.js";
import { Source } from "../sources/source.model.js";
import { findConflicts, rangeFlag } from "./analyse.js";

const MAX_FACTS = 20_000; // bounded query; a case beyond this needs pagination, not a bigger read

export const SECTIONS = [
  ["allergy", "Allergies & intolerances"],
  ["medication", "Medications"],
  ["condition", "Problems & diagnoses"],
  ["lab_result", "Lab results"],
  ["vital_sign", "Vital signs"],
  ["imaging_finding", "Imaging & radiology"],
  ["procedure", "Procedures & surgeries"],
  ["encounter", "Encounters & admissions"],
  ["immunization", "Immunizations"],
  ["family_history", "Family history"],
  ["social_history", "Social history"],
  ["other", "Other findings"],
];

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const parsedDate = (d) => (d && !Number.isNaN(Date.parse(d)) ? Date.parse(d) : Infinity);
const sourceName = (s) =>
  s.kind === "file" ? s.file.originalName : s.kind === "note" ? "Note" : "Patient questionnaire";

/**
 * Builds the mega-document from stored facts. Pure read: nothing is generated here,
 * every entry is a stored fact carrying its citation.
 */
export async function compileCase(caseDoc) {
  const [sources, facts] = await Promise.all([
    Source.find({ caseId: caseDoc._id }).sort({ createdAt: 1, _id: 1 }).lean(),
    Fact.find({ caseId: caseDoc._id }).limit(MAX_FACTS + 1).lean(),
  ]);
  if (facts.length > MAX_FACTS) throw new AppError(422, "CASE_TOO_LARGE", "This case has too many facts to compile at once");

  // S1, S2… in upload order: stable across compilations
  const refs = new Map(sources.map((s, i) => [String(s._id), `S${i + 1}`]));
  const sourceById = new Map(sources.map((s) => [String(s._id), s]));

  const entries = facts.map((f) => ({
    id: String(f._id),
    category: f.category,
    label: f.label,
    value: f.value,
    date: f.date,
    details: f.details,
    origin: f.origin,
    quote: f.quote,
    citation: { ref: refs.get(String(f.sourceId)), sourceId: String(f.sourceId), page: f.page, quote: f.quote },
  }));
  for (const e of entries) if (e.category === "lab_result") e.flag = rangeFlag(e);

  const byCategory = Object.groupBy(entries, (e) => e.category);
  const sections = SECTIONS.map(([key, title]) => ({
    key,
    title,
    facts: (byCategory[key] ?? []).sort(
      (a, b) => parsedDate(a.date) - parsedDate(b.date) || a.citation.ref.localeCompare(b.citation.ref, "en", { numeric: true })
    ),
  }));

  // images attached below the imaging section: every uploaded image, cited or not
  const imaging = sections.find((s) => s.key === "imaging_finding");
  imaging.images = sources
    .filter((s) => s.kind === "file" && IMAGE_TYPES.has(s.file.mimeType))
    .map((s) => ({
      sourceId: String(s._id),
      ref: refs.get(String(s._id)),
      name: s.file.originalName,
      mimeType: s.file.mimeType,
      citedBy: entries.filter((e) => e.citation.sourceId === String(s._id)).map((e) => e.id),
    }));

  // cited PDF pages holding imaging findings get rendered into the PDF export
  imaging.renderedPages = [
    ...new Map(
      imaging.facts
        .filter((f) => sourceById.get(f.citation.sourceId)?.file?.mimeType === "application/pdf")
        .map((f) => [`${f.citation.sourceId}:${f.citation.page}`, { sourceId: f.citation.sourceId, ref: f.citation.ref, page: f.citation.page }])
    ).values(),
  ];

  const counts = Object.fromEntries(SECTIONS.map(([key]) => [key, byCategory[key]?.length ?? 0]));
  return {
    case: { id: String(caseDoc._id), patientName: caseDoc.patientName },
    generatedAt: new Date().toISOString(),
    alerts: {
      allergies: sections.find((s) => s.key === "allergy").facts,
      conflicts: findConflicts(entries),
      abnormalLabs: entries.filter((e) => e.flag),
    },
    sections,
    counts,
    sources: sources.map((s) => ({
      ref: refs.get(String(s._id)),
      id: String(s._id),
      kind: s.kind,
      name: sourceName(s),
      mimeType: s.file?.mimeType,
      uploadedBy: s.uploadedBy,
      uploadedAt: s.createdAt,
      status: s.processing?.status,
      error: s.processing?.error,
      pages: s.processing?.pages,
      aiStructured: s.processing?.aiStructured,
      factCount: s.processing?.factCount ?? 0,
      uncoveredPages: s.processing?.uncoveredPages ?? [],
      lowConfidencePages: s.processing?.lowConfidencePages ?? [],
    })),
    // what the document does NOT yet cover, stated plainly
    completeness: {
      pending: sources.filter((s) => ["pending", "processing"].includes(s.processing?.status)).map((s) => refs.get(String(s._id))),
      failed: sources.filter((s) => s.processing?.status === "failed").map((s) => refs.get(String(s._id))),
      notStructured: sources
        .filter((s) => s.processing?.status === "done" && !s.processing.aiStructured)
        .map((s) => refs.get(String(s._id))),
    },
  };
}
