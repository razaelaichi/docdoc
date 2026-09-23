import mongoose from "mongoose";
import { getObject } from "../../lib/storage.js";
import { histogram } from "../../lib/metrics.js";
import { logger } from "../../lib/logger.js";
import { recordAudit } from "../audit/audit.service.js";
import { syncToLinkedPatient } from "../records/records.service.js";
import { aiEnabled, chat as nimChat } from "../agent/llm.js";
import { Source } from "../sources/source.model.js";
import { extractFile } from "./extract.js";
import { Fact } from "./fact.model.js";
import { questionnaireToFacts } from "./questionnaire.js";
import { SourceText } from "./sourceText.model.js";
import { structureDocument } from "./structure.js";

const LOW_OCR_CONFIDENCE = 60;
const stageDuration = histogram("pipeline_stage_duration_seconds", "Pipeline stage duration", ["stage"], [0.1, 0.5, 1, 5, 15, 60, 300, 900]);

const timed = async (stage, fn) => {
  const end = stageDuration.startTimer({ stage });
  try {
    return await fn();
  } finally {
    end();
  }
};

/**
 * Source → text pages → cited facts. Re-running replaces the previous result,
 * so processing is idempotent and safe to retry.
 */
export async function processSource(source, { chat = nimChat, ai = aiEnabled } = {}) {
  const origin = source.uploadedBy === "patient" && source.kind !== "file" ? "patient-reported" : "document";
  let pages;
  let facts = [];
  let uncoveredPages = [];
  let structured = source.kind === "questionnaire"; // questionnaires are structured by construction

  if (source.kind === "questionnaire") {
    ({ pages, facts } = questionnaireToFacts(source.questionnaire));
  } else {
    pages =
      source.kind === "note"
        ? [{ page: 1, text: source.note, method: "entered" }]
        : await timed("extract", async () => extractFile(await getObject(source.file.storageKey), source.file.mimeType));

    if (ai && pages.some((p) => p.text.trim())) {
      const audit = (action, meta) =>
        recordAudit(action, { meta: { ...meta, caseId: source.caseId, sourceId: source._id } });
      ({ facts, uncoveredPages } = await timed("structure", () =>
        structureDocument({ label: `source-${source._id}`, pages, chat, audit })
      ));
      structured = true;
    }
  }

  // text, facts and status change together or not at all
  await mongoose.connection.transaction(async (session) => {
    await SourceText.replaceOne(
      { sourceId: source._id },
      { sourceId: source._id, caseId: source.caseId, pages },
      { upsert: true, session }
    );
    await Fact.deleteMany({ sourceId: source._id }, { session });
    await Fact.insertMany(
      facts.map((f) => ({ ...f, caseId: source.caseId, sourceId: source._id, origin })),
      { session }
    );
    await Source.updateOne(
      { _id: source._id },
      {
        "processing.status": "done",
        "processing.error": null,
        "processing.lockedUntil": null,
        "processing.pages": pages.length,
        "processing.aiStructured": structured,
        "processing.factCount": facts.length,
        "processing.uncoveredPages": uncoveredPages,
        "processing.lowConfidencePages": pages.filter((p) => p.confidence < LOW_OCR_CONFIDENCE).map((p) => p.page),
      },
      { session }
    );
  });

  // a visit linked to a patient account is mirrored into their health record as it is processed;
  // a failed mirror never fails the doctor's processing (claiming the link again re-syncs)
  await syncToLinkedPatient(await Source.findById(source._id).lean()).catch((err) =>
    logger.error({ err, sourceId: source._id }, "could not mirror source to the patient's record")
  );
}
