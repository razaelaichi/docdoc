import mongoose from "mongoose";
import { toMongoSort } from "../../lib/pagination.js";
import { logger } from "../../lib/logger.js";
import { deleteObject } from "../../lib/storage.js";
import { Fact } from "../processing/fact.model.js";
import { SourceText } from "../processing/sourceText.model.js";
import { Source } from "../sources/source.model.js";
import { Case } from "./case.model.js";
import { UploadLink } from "./uploadLink.model.js";
import { RecordShare } from "../records/recordShare.model.js";

export const createCase = (data) => Case.create(data);
export const findCaseByIdempotencyKey = (ownerId, idempotencyKey) =>
  Case.findOne({ ownerId, idempotencyKey }).lean();
// ownership is part of the query: another doctor's case is simply "not found"
export const findOwnedCase = (caseId, ownerId) => Case.findOne({ _id: caseId, ownerId }).lean();

export async function listOwnedCases(ownerId, { page, limit, sort, search }) {
  const filter = { ownerId };
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.patientName = mongoose.trusted({ $regex: escaped, $options: "i" });
  }
  const [items, total] = await Promise.all([
    Case.find(filter).sort(toMongoSort(sort)).skip((page - 1) * limit).limit(limit).lean(),
    Case.countDocuments(filter),
  ]);
  return { items, total };
}

export const createUploadLink = (data) => UploadLink.create(data);
export const listUploadLinks = (caseId) => UploadLink.find({ caseId }).sort({ createdAt: -1 }).limit(50).lean();
export const revokeUploadLink = (linkId, caseId) =>
  UploadLink.findOneAndUpdate({ _id: linkId, caseId, revokedAt: null }, { revokedAt: new Date() }).lean();
export const findActiveUploadLink = (tokenHash) =>
  UploadLink.findOne({ tokenHash, revokedAt: null, expiresAt: mongoose.trusted({ $gt: new Date() }) }).lean();

/** Removes a case and everything derived from it; files are deleted once the records are gone. */
export async function deleteCaseCascade(caseId) {
  const keys = (await Source.find({ caseId, "file.storageKey": mongoose.trusted({ $exists: true }) }).select("file.storageKey").lean()).map(
    (s) => s.file.storageKey
  );
  const counts = {};
  await mongoose.connection.transaction(async (session) => {
    counts.facts = (await Fact.deleteMany({ caseId }, { session })).deletedCount;
    counts.texts = (await SourceText.deleteMany({ caseId }, { session })).deletedCount;
    counts.sources = (await Source.deleteMany({ caseId }, { session })).deletedCount;
    counts.uploadLinks = (await UploadLink.deleteMany({ caseId }, { session })).deletedCount;
    // access to a patient's record ends with the case it was granted for (the record itself is the patient's)
    counts.shares = (await RecordShare.deleteMany({ doctorCaseId: caseId }, { session })).deletedCount;
    await Case.deleteOne({ _id: caseId }, { session });
  });
  // after commit: a failed file delete leaves an unreferenced file, never a record without its file
  const results = await Promise.allSettled(keys.map(deleteObject));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed) logger.error({ caseId, failed }, "some case files could not be deleted");
  return { ...counts, files: keys.length - failed };
}
