import { randomBytes } from "node:crypto";
import { config } from "../../config/index.js";
import { notFound } from "../../lib/errors.js";
import { recordAudit } from "../audit/audit.service.js";
import { hashToken } from "../auth/tokens.js";
import * as cases from "./case.repository.js";

export async function createCase(user, { patientName }, idempotencyKey, ctx) {
  if (idempotencyKey) {
    const existing = await cases.findCaseByIdempotencyKey(user.id, idempotencyKey);
    if (existing) return { case: existing, created: false };
  }
  let created;
  try {
    created = await cases.createCase({ ownerId: user.id, patientName, idempotencyKey });
  } catch (err) {
    // two concurrent retries: the unique index lets one win, the other returns the winner
    if (err.code === 11000 && idempotencyKey) {
      return { case: await cases.findCaseByIdempotencyKey(user.id, idempotencyKey), created: false };
    }
    throw err;
  }
  await recordAudit("case.create", { actorId: user.id, ...ctx, meta: { caseId: created._id } });
  return { case: created, created: true };
}

export async function getOwnedCase(user, caseId) {
  const found = await cases.findOwnedCase(caseId, user.id);
  if (!found) throw notFound("Case not found");
  return found;
}

export const listCases = (user, query) => cases.listOwnedCases(user.id, query);

export async function createUploadLink(user, caseId, ctx) {
  await getOwnedCase(user, caseId);
  const token = randomBytes(24).toString("base64url");
  const link = await cases.createUploadLink({
    caseId,
    createdBy: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + config.UPLOAD_LINK_TTL_DAYS * 86_400_000),
  });
  await recordAudit("upload_link.create", { actorId: user.id, ...ctx, meta: { caseId, linkId: link._id } });
  return { link, url: `${config.PUBLIC_APP_URL}/intake/${token}` };
}

export async function listUploadLinks(user, caseId) {
  await getOwnedCase(user, caseId);
  return cases.listUploadLinks(caseId);
}

export async function revokeUploadLink(user, caseId, linkId, ctx) {
  await getOwnedCase(user, caseId);
  const link = await cases.revokeUploadLink(linkId, caseId);
  if (!link) throw notFound("Active upload link not found");
  await recordAudit("upload_link.revoke", { actorId: user.id, ...ctx, meta: { caseId, linkId } });
}

export async function findCaseForUploadToken(token) {
  const link = await cases.findActiveUploadLink(hashToken(token));
  if (!link) throw notFound("This upload link is invalid or has expired");
  return link;
}

export async function deleteCase(user, caseId, ctx) {
  await getOwnedCase(user, caseId);
  const counts = await cases.deleteCaseCascade(caseId);
  await recordAudit("case.delete", { actorId: user.id, ...ctx, meta: { caseId, ...counts } });
}
