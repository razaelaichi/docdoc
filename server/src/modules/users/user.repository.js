import { User } from "./user.model.js";

export const createUser = (data) => User.create(data);
export const findUserById = (id) => User.findById(id).lean();
export const findUserByEmail = (email) => User.findOne({ email }).lean();
export const findUserForAuth = (email) =>
  User.findOne({ email }).select("+passwordHash +failedLogins +lockUntil").lean();

export async function incrementFailedLogins(id) {
  const user = await User.findByIdAndUpdate(
    id,
    { $inc: { failedLogins: 1 } },
    { returnDocument: "after", projection: "+failedLogins" }
  ).lean();
  return user.failedLogins;
}

export const lockUser = (id, until) => User.updateOne({ _id: id }, { failedLogins: 0, lockUntil: until });
export const recordLogin = (id) =>
  User.updateOne({ _id: id }, { failedLogins: 0, lockUntil: null, lastLoginAt: new Date() });
export const markEmailVerified = (id) => User.updateOne({ _id: id, emailVerifiedAt: null }, { emailVerifiedAt: new Date() });
export const setPassword = (id, passwordHash) =>
  User.updateOne({ _id: id }, { passwordHash, failedLogins: 0, lockUntil: null });
