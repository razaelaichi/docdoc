import mongoose from "mongoose";
import { UserToken } from "./userToken.model.js";

export const saveUserToken = (doc) => UserToken.create(doc);

// atomic: a token can be redeemed exactly once, even under concurrent requests
export const consumeUserToken = (tokenHash, purpose) =>
  UserToken.findOneAndUpdate(
    { tokenHash, purpose, usedAt: null, expiresAt: mongoose.trusted({ $gt: new Date() }) },
    { usedAt: new Date() }
  ).lean();
