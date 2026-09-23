import mongoose from "mongoose";

const caseSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    patientName: { type: String, required: true, trim: true, maxlength: 200 },
    // clinical: a doctor's case. personal: a patient's own health record (ownerId is the patient),
    // which reuses the whole source/fact pipeline and the compiled record.
    kind: { type: String, enum: ["clinical", "personal"], default: "clinical" },
    // set when the patient opens the case's upload link while signed in: the visit is then mirrored
    // into their personal record. One patient per case; never exposed to other patients.
    linkedPatientId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    idempotencyKey: { type: String, select: false },
  },
  { timestamps: true }
);

// a doctor's case list, newest first
caseSchema.index({ ownerId: 1, createdAt: -1 });
// exactly one personal record per patient
caseSchema.index({ ownerId: 1 }, { unique: true, partialFilterExpression: { kind: "personal" } });
// retrying a create with the same Idempotency-Key returns the first case instead of a duplicate
caseSchema.index(
  { ownerId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } }
);

export const Case = mongoose.model("Case", caseSchema);
