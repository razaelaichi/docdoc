import mongoose from "mongoose";

// A patient's upload link. Only the token hash is stored; the raw token is shown once.
const uploadLinkSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, expires: 0 }, // TTL: removed once expired
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const UploadLink = mongoose.model("UploadLink", uploadLinkSchema, "upload_links");
