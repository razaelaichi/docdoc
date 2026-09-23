import mongoose from "mongoose";

const auditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true }, // e.g. "auth.login.failure"
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    ip: String,
    requestId: String,
    meta: mongoose.Schema.Types.Mixed, // never passwords, tokens or clinical data
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

// "who did what" and "what happened when" are the two lookups
auditSchema.index({ actorId: 1, createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });

// append-only from the app's side; the DB user should also lack update/remove on this collection
const reject = () => {
  throw new Error("Audit log is append-only");
};
auditSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"], reject);

export const AuditLog = mongoose.model("AuditLog", auditSchema, "audit_logs");
