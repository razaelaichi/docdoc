import mongoose from "mongoose";

// Single-use tokens emailed to a user (password reset, email verification). Only the hash is stored.
const userTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    purpose: { type: String, enum: ["reset_password", "verify_email"], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, expires: 0 }, // TTL cleanup
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const UserToken = mongoose.model("UserToken", userTokenSchema, "user_tokens");
