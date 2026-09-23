import mongoose from "mongoose";
import { RefreshToken } from "./refreshToken.model.js";

export const saveRefreshToken = (doc) => RefreshToken.create(doc);
export const findRefreshToken = (tokenHash) => RefreshToken.findOne({ tokenHash }).lean();

// atomic: of two concurrent requests with the same token, only one gets it back
export const consumeRefreshToken = (tokenHash) =>
  RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: mongoose.trusted({ $gt: new Date() }) },
    { revokedAt: new Date() }
  ).lean();

export const revokeFamily = (familyId) =>
  RefreshToken.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() });

export const revokeAllForUser = (userId) =>
  RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
