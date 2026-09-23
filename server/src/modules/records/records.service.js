import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { conflict, notFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { sendMailInBackground } from "../../lib/mailer.js";
import { deleteObject, getObject, putObject } from "../../lib/storage.js";
import { config } from "../../config/index.js";
import { recordAudit } from "../audit/audit.service.js";
import { Case } from "../cases/case.model.js";
import { findCaseForUploadToken, getOwnedCase } from "../cases/case.service.js";
import { Fact } from "../processing/fact.model.js";
import { SourceText } from "../processing/sourceText.model.js";
import { Source } from "../sources/source.model.js";
import { User } from "../users/user.model.js";
import { RecordShare } from "./recordShare.model.js";

const trusted = mongoose.trusted;

// ---------- the personal health record ----------

/** The patient's personal record, created on first use (one per patient, enforced by a unique index). */
export async function getPersonalRecord(user) {
  const found = await Case.findOne({ ownerId: user.id, kind: "personal" }).lean();
  if (found) return found;
  const account = await User.findById(user.id).lean();
  try {
    return (await Case.create({ ownerId: user.id, kind: "personal", patientName: account.name })).toObject();
  } catch (err) {
    if (err.code !== 11000) throw err; // two first requests at once: the other one created it
    return Case.findOne({ ownerId: user.id, kind: "personal" }).lean();
  }
}

/**
 * Mirrors one processed source of a doctor's case into a personal record: the file (a copy of its
 * own, so deleting the doctor's case never touches the patient's copy), its extracted text and its
 * verified facts. Nothing is re-run through the AI. Idempotent: re-syncing a source replaces its text
 * and facts (e.g. after the doctor reprocessed it), and a file the patient already has is skipped.
 */
export async function copySourceToRecord(source, record, doctorName) {
  const existing = await Source.findOne({ caseId: record._id, "copiedFrom.sourceId": source._id }).lean();
  if (!existing && source.file?.sha256 && (await Source.exists({ caseId: record._id, "file.sha256": source.file.sha256 }))) {
    return "duplicate";
  }

  const [text, facts] = await Promise.all([
    SourceText.findOne({ sourceId: source._id }).lean(),
    Fact.find({ sourceId: source._id }).lean(),
  ]);

  let storageKey = existing?.file?.storageKey;
  if (!existing && source.file?.storageKey) {
    storageKey = `${randomUUID()}.${source.file.storageKey.split(".").pop()}`;
    await putObject(storageKey, await getObject(source.file.storageKey));
  }

  try {
    await mongoose.connection.transaction(async (session) => {
      let copyId = existing?._id;
      if (!copyId) {
        const [copy] = await Source.create(
          [
            {
              caseId: record._id,
              uploadedBy: source.uploadedBy,
              kind: source.kind,
              note: source.note,
              questionnaire: source.questionnaire,
              file: source.file?.storageKey ? { ...source.file, storageKey } : undefined,
              copiedFrom: { caseId: source.caseId, sourceId: source._id, doctorName },
              processing: { ...source.processing, lockedUntil: null },
              createdAt: source.createdAt,
            },
          ],
          { session }
        );
        copyId = copy._id;
      } else {
        await Source.updateOne({ _id: copyId }, { processing: { ...source.processing, lockedUntil: null } }, { session });
      }
      if (text) {
        await SourceText.replaceOne({ sourceId: copyId }, { sourceId: copyId, caseId: record._id, pages: text.pages }, { upsert: true, session });
      }
      await Fact.deleteMany({ sourceId: copyId }, { session });
      await Fact.insertMany(
        facts.map((f) => ({
          caseId: record._id,
          sourceId: copyId,
          origin: f.origin,
          category: f.category,
          label: f.label,
          value: f.value,
          date: f.date,
          details: f.details,
          page: f.page,
          quote: f.quote,
        })),
        { session }
      );
    });
  } catch (err) {
    if (!existing && storageKey) await deleteObject(storageKey);
    if (err.code === 11000) return "duplicate"; // a concurrent sync or an identical file won the race
    throw err;
  }
  return existing ? "updated" : "copied";
}

const doctorNameOf = async (caseDoc) => (await User.findById(caseDoc.ownerId).select("name").lean())?.name ?? "Your doctor";

/** Called by the pipeline when a source finishes: mirrors it if its case is linked to a patient. */
export async function syncToLinkedPatient(source) {
  const caseDoc = await Case.findById(source.caseId).lean();
  if (!caseDoc?.linkedPatientId) return;
  const record = await getPersonalRecord({ id: caseDoc.linkedPatientId });
  const result = await copySourceToRecord(source, record, await doctorNameOf(caseDoc));
  logger.info({ caseId: caseDoc._id, sourceId: source._id, result }, "source mirrored to personal record");
}

// ---------- linking a doctor's upload link to the patient's account ----------

async function linkCase(user, token) {
  const link = await findCaseForUploadToken(token);
  // claim only if unclaimed or already ours; never reveal who else holds it
  const caseDoc = await Case.findOneAndUpdate(
    { _id: link.caseId, kind: "clinical", linkedPatientId: trusted({ $in: [null, new mongoose.Types.ObjectId(String(user.id))] }) },
    { linkedPatientId: user.id },
    { returnDocument: "after" }
  ).lean();
  if (!caseDoc) throw conflict("This link belongs to another DocDoc account. Ask your doctor for a new one.");
  return caseDoc;
}

/**
 * A signed-in patient opened their doctor's link: the visit is linked to their account and
 * everything already processed in it is copied into their personal record. Later documents
 * (from either side) follow automatically as the pipeline finishes them.
 */
export async function claimLink(user, token, ctx) {
  const caseDoc = await linkCase(user, token);
  const record = await getPersonalRecord(user);
  const doctorName = await doctorNameOf(caseDoc);
  const done = await Source.find({ caseId: caseDoc._id, "processing.status": "done" }).lean();
  let copied = 0;
  for (const source of done) if ((await copySourceToRecord(source, record, doctorName)) === "copied") copied++;
  await recordAudit("record.link_visit", { actorId: user.id, ...ctx, meta: { caseId: caseDoc._id, recordId: record._id, copied } });

  const share = await RecordShare.findOne({ doctorCaseId: caseDoc._id, live: true }).lean();
  const email = await emailOf(user);
  const shareMine = share && (String(share.patientId) === String(user.id) || (!share.patientId && email && share.patientEmail === email));
  return { doctorName, copied, share: shareMine ? { id: String(share._id), status: share.status } : null };
}

/** From the link page: the patient offers their whole record to this doctor (their own approval). */
export async function shareWithLinkDoctor(user, token, ctx) {
  const caseDoc = await linkCase(user, token);
  const record = await getPersonalRecord(user);
  const email = await emailOf(user);
  const live = await RecordShare.findOne({ doctorCaseId: caseDoc._id, live: true }).lean();
  if (live) {
    const mine = String(live.patientId) === String(user.id) || (!live.patientId && email && live.patientEmail === email);
    if (!mine) throw conflict("This case already has an open access request. Ask your doctor to withdraw it, then try again.");
    if (live.status === "active") return live;
    return approve(user, live._id, ctx); // a pending request for us: approving it is the same thing
  }
  const share = await RecordShare.create({
    doctorId: caseDoc.ownerId,
    doctorCaseId: caseDoc._id,
    patientId: user.id,
    patientEmail: email,
    recordId: record._id,
    status: "active",
    requestedBy: "patient",
    live: true,
    respondedAt: new Date(),
  });
  await recordAudit("record.share.grant", { actorId: user.id, ...ctx, meta: { shareId: share._id, doctorId: caseDoc.ownerId, via: "link" } });
  return share.toObject();
}

// ---------- doctor side ----------

/**
 * A doctor asks for access to a patient's record for one case. The answer is the same whether or
 * not the email has an account; the request waits for the patient to sign up if needed.
 */
export async function requestAccess(doctor, caseId, patientEmail, ctx) {
  const caseDoc = await getOwnedCase(doctor, caseId);
  const live = await RecordShare.findOne({ doctorCaseId: caseDoc._id, live: true }).lean();
  if (live) throw conflict("This case already has an open request or active access. Withdraw it first.");

  // attach to an account only if it has proved it owns the address
  const patient = await User.findOne({ email: patientEmail, role: "patient", emailVerifiedAt: trusted({ $ne: null }) }).lean();
  const share = await RecordShare.create({
    doctorId: doctor.id,
    doctorCaseId: caseDoc._id,
    patientEmail,
    patientId: patient?._id,
    status: "pending",
    requestedBy: "doctor",
    live: true,
  });
  const doctorName = await doctorNameOf(caseDoc);
  sendMailInBackground({
    to: patientEmail,
    subject: `${doctorName} asked to see your DocDoc health record`,
    text: `${doctorName} would like to see your health record on DocDoc, so you don't have to upload your documents again.\n\nNothing is shared until you approve. Sign in (or create a patient account with this email) to approve or decline:\n${config.PUBLIC_APP_URL}/patient\n\nIf you don't know this doctor, decline the request or ignore this email.`,
  });
  await recordAudit("record.share.request", { actorId: doctor.id, ...ctx, meta: { shareId: share._id, caseId: caseDoc._id } });
  return share.toObject();
}

export async function getAccessForCase(doctor, caseId) {
  const caseDoc = await getOwnedCase(doctor, caseId);
  const latest = await RecordShare.findOne({ doctorCaseId: caseDoc._id }).sort({ createdAt: -1 }).lean();
  return { caseDoc, share: latest };
}

export async function withdrawAccess(doctor, caseId, ctx) {
  const caseDoc = await getOwnedCase(doctor, caseId);
  const share = await RecordShare.findOneAndUpdate(
    { doctorCaseId: caseDoc._id, live: true },
    { status: "cancelled", live: null, endedAt: new Date() },
    { returnDocument: "after" }
  ).lean();
  if (!share) throw notFound("No open request or active access for this case");
  await recordAudit("record.share.cancel", { actorId: doctor.id, ...ctx, meta: { shareId: share._id, caseId: caseDoc._id } });
}

/** The patient's record behind a doctor's case, only while the patient's approval stands. */
export async function getSharedRecord(doctor, caseId) {
  const caseDoc = await getOwnedCase(doctor, caseId);
  const share = await RecordShare.findOneAndUpdate(
    { doctorCaseId: caseDoc._id, doctorId: doctor.id, status: "active", live: true },
    { lastAccessedAt: new Date() },
    { returnDocument: "after" }
  ).lean();
  if (!share) throw notFound("The patient has not shared their health record for this case");
  const record = await Case.findOne({ _id: share.recordId, kind: "personal" }).lean();
  if (!record) throw notFound("The patient has not shared their health record for this case");
  return { record, share };
}

// ---------- patient side ----------

// The patient's email, only once they've proved they own it. Requests a doctor addressed "to this
// email" must never reach someone who merely typed it at sign-up: they could approve and show the
// doctor their own history under another person's name.
const emailOf = async (user) => {
  const account = await User.findById(user.id).select("email emailVerifiedAt").lean();
  return account?.emailVerifiedAt ? account.email : undefined;
};

// requests addressed to this patient: by account, or by (verified) email before the account existed
const mineFilter = (user, email) =>
  trusted({
    $or: [{ patientId: new mongoose.Types.ObjectId(String(user.id)) }, ...(email ? [{ patientId: null, patientEmail: email }] : [])],
  });

export async function listShares(user) {
  const email = await emailOf(user);
  const shares = await RecordShare.find(mineFilter(user, email)).sort({ createdAt: -1 }).limit(200).lean();
  const doctors = new Map(
    (await User.find({ _id: trusted({ $in: [...new Set(shares.map((s) => String(s.doctorId)))] }) }).select("name email").lean()).map((d) => [String(d._id), d])
  );
  return shares.map((s) => ({ ...s, doctor: doctors.get(String(s.doctorId)) }));
}

async function respond(user, shareId, approveIt, ctx) {
  const email = await emailOf(user);
  const record = approveIt ? await getPersonalRecord(user) : null;
  const share = await RecordShare.findOneAndUpdate(
    { _id: shareId, status: "pending", ...mineFilter(user, email) },
    approveIt
      ? { status: "active", patientId: user.id, recordId: record._id, respondedAt: new Date() }
      : { status: "declined", patientId: user.id, live: null, respondedAt: new Date(), endedAt: new Date() },
    { returnDocument: "after" }
  ).lean();
  if (!share) throw notFound("Request not found or already answered");
  await recordAudit(approveIt ? "record.share.grant" : "record.share.decline", { actorId: user.id, ...ctx, meta: { shareId, doctorId: share.doctorId } });
  return share;
}

export const approve = (user, shareId, ctx) => respond(user, shareId, true, ctx);
export const decline = (user, shareId, ctx) => respond(user, shareId, false, ctx);

export async function revoke(user, shareId, ctx) {
  const share = await RecordShare.findOneAndUpdate(
    { _id: shareId, patientId: user.id, status: "active" },
    { status: "revoked", live: null, endedAt: new Date() },
    { returnDocument: "after" }
  ).lean();
  if (!share) throw notFound("Active access not found");
  await recordAudit("record.share.revoke", { actorId: user.id, ...ctx, meta: { shareId, doctorId: share.doctorId } });
  return share;
}
