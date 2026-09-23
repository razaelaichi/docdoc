import mongoose from "mongoose";

// Structured health questionnaire filled in by the patient (patient-reported, unverified).
const questionnaireSchema = new mongoose.Schema(
  {
    allergies: [{ substance: String, reaction: String, severity: String, _id: false }],
    medications: [{ name: String, dose: String, frequency: String, _id: false }],
    conditions: [String],
    surgeries: [String],
    familyHistory: String,
    other: String,
  },
  { _id: false }
);

// One input to a case: an uploaded file, a text note or a questionnaire, from the patient or a doctor.
// Referenced (not embedded in the case) because a case can collect hundreds of them.
const sourceSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    uploadedBy: { type: String, enum: ["patient", "doctor"], required: true },
    uploaderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // doctors only
    kind: { type: String, enum: ["file", "note", "questionnaire"], required: true },
    note: { type: String, maxlength: 10_000 },
    questionnaire: questionnaireSchema,
    file: {
      originalName: { type: String, maxlength: 255 }, // display only, never used as a path
      storageKey: String,
      mimeType: String, // detected from the bytes, not the client's claim
      size: Number,
      sha256: String,
    },
    // set on copies mirrored from a doctor's case into a patient's personal record
    copiedFrom: {
      caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case" },
      sourceId: { type: mongoose.Schema.Types.ObjectId, ref: "Source" },
      doctorName: { type: String, maxlength: 100 },
    },
    // background pipeline state; the source document doubles as its own job record
    processing: {
      status: { type: String, enum: ["pending", "processing", "done", "failed"], default: "pending" },
      attempts: { type: Number, default: 0 },
      nextAttemptAt: { type: Date, default: Date.now },
      lockedUntil: Date,
      error: String, // client-safe message only
      pages: Number,
      aiStructured: Boolean,
      factCount: Number,
      uncoveredPages: [Number], // pages that yielded no facts and were not declared non-clinical
      lowConfidencePages: [Number], // OCR confidence below threshold
    },
  },
  { timestamps: true }
);

sourceSchema.index({ caseId: 1, createdAt: 1 });
sourceSchema.index({ "processing.status": 1, "processing.nextAttemptAt": 1 }); // worker queue
// the same file uploaded twice to one case is stored once
sourceSchema.index(
  { caseId: 1, "file.sha256": 1 },
  { unique: true, partialFilterExpression: { "file.sha256": { $exists: true } } }
);

// a doctor-case source is mirrored into a personal record at most once
sourceSchema.index(
  { caseId: 1, "copiedFrom.sourceId": 1 },
  { unique: true, partialFilterExpression: { "copiedFrom.sourceId": { $exists: true } } }
);

export const Source = mongoose.model("Source", sourceSchema);
