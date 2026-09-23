import mongoose from "mongoose";

// A doctor's access to a patient's personal health record, always approved by the patient.
// pending → active (approved) | declined; active → revoked (by the patient) | cancelled (by the doctor).
export const SHARE_STATUSES = ["pending", "active", "declined", "revoked", "cancelled"];

const recordShareSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    doctorCaseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    // a doctor asks by email; the request attaches to the patient when an account with that email
    // exists or is created later, so the doctor can't tell whether the email has an account
    patientEmail: { type: String, lowercase: true, trim: true, maxlength: 254 },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    recordId: { type: mongoose.Schema.Types.ObjectId, ref: "Case" }, // set on approval
    status: { type: String, enum: SHARE_STATUSES, required: true },
    requestedBy: { type: String, enum: ["doctor", "patient"], required: true },
    live: { type: Boolean }, // true while pending or active: at most one live share per doctor case
    respondedAt: Date,
    endedAt: Date,
    lastAccessedAt: Date,
  },
  { timestamps: true }
);

recordShareSchema.index({ doctorCaseId: 1 }, { unique: true, partialFilterExpression: { live: true } });
recordShareSchema.index({ patientId: 1, status: 1 });
recordShareSchema.index({ patientEmail: 1, status: 1 });

export const RecordShare = mongoose.model("RecordShare", recordShareSchema, "record_shares");
