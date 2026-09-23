import mongoose from "mongoose";

// One document per issued refresh token. Tokens from one login share a familyId,
// so a stolen-and-replayed token can revoke the whole session.
const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, expires: 0 }, // TTL index: Mongo deletes expired tokens
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema, "refresh_tokens");
