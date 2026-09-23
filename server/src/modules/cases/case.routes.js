import { Router } from "express";
import { z } from "zod";
import { notFound, validationFailed } from "../../lib/errors.js";
import { objectId } from "../../lib/ids.js";
import { pageOf, paginationQuery } from "../../lib/pagination.js";
import { limiter } from "../../lib/rateLimit.js";
import { ok } from "../../lib/respond.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/authorize.js";
import { acceptFiles } from "../../middleware/upload.js";
import { validate } from "../../middleware/validate.js";
import { recordAudit } from "../audit/audit.service.js";
import { documentRoutes } from "../document/document.routes.js";
import * as records from "../records/records.service.js";
import { toShareForDoctorDto } from "../records/records.dto.js";
import { requeueSource } from "../processing/queue.js";
import { toSourceDto } from "../sources/source.dto.js";
import * as sourceService from "../sources/source.service.js";
import { toCaseDto, toUploadLinkDto } from "./case.dto.js";
import * as caseService from "./case.service.js";

const caseParams = z.strictObject({ caseId: objectId });
const createCaseBody = z.strictObject({ patientName: z.string().trim().min(1).max(200) });
const listCasesQuery = paginationQuery(["createdAt", "patientName"], "-createdAt").extend({
  search: z.string().trim().max(100).optional(),
});
const listSourcesQuery = paginationQuery(["createdAt"], "createdAt");
const noteBody = z.strictObject({ note: z.string().trim().max(10_000).optional() });

const ctx = (req) => ({ ip: req.ip, requestId: req.id });

function idempotencyKey(req) {
  const key = req.headers["idempotency-key"];
  if (key !== undefined && !/^[\w-]{8,100}$/.test(key)) {
    throw validationFailed([{ field: "headers.idempotency-key", message: "must be 8-100 characters [A-Za-z0-9_-]" }]);
  }
  return key;
}

export const caseRouter = Router();
caseRouter.use(authenticate, requireRole("doctor"));
// a malformed id is simply a case that doesn't exist
const caseIdOf = (req) => {
  const parsed = objectId.safeParse(req.params.caseId);
  if (!parsed.success) throw notFound("Case not found");
  return parsed.data;
};
const ownCase = async (req) => ({ record: await caseService.getOwnedCase(req.user, caseIdOf(req)), via: "own-case" });
// the patient's own health record, visible only while the patient's approval for this case stands
const sharedRecord = async (req) => ({ record: (await records.getSharedRecord(req.user, caseIdOf(req))).record, via: "patient-share" });
caseRouter.use("/:caseId/shared-record", documentRoutes(sharedRecord));
caseRouter.use("/:caseId", documentRoutes(ownCase));

caseRouter.post("/", validate({ body: createCaseBody }), async (req, res) => {
  const result = await caseService.createCase(req.user, req.valid.body, idempotencyKey(req), ctx(req));
  ok(res, toCaseDto(result.case), { status: result.created ? 201 : 200 });
});

caseRouter.get("/", limiter(1, 60), validate({ query: listCasesQuery }), async (req, res) => {
  const { items, total } = await caseService.listCases(req.user, req.valid.query);
  ok(res, pageOf(items.map(toCaseDto), total, req.valid.query));
});

caseRouter.get("/:caseId", validate({ params: caseParams }), async (req, res) => {
  ok(res, toCaseDto(await caseService.getOwnedCase(req.user, req.valid.params.caseId)));
});

// permanent: patient data minimisation / right to erasure
caseRouter.delete("/:caseId", limiter(15, 20), validate({ params: caseParams }), async (req, res) => {
  await caseService.deleteCase(req.user, req.valid.params.caseId, ctx(req));
  ok(res, null, { message: "Case and all its data deleted" });
});

caseRouter.post("/:caseId/upload-links", validate({ params: caseParams }), async (req, res) => {
  const { link, url } = await caseService.createUploadLink(req.user, req.valid.params.caseId, ctx(req));
  // url carries the raw token: returned exactly once, never stored
  ok(res, { ...toUploadLinkDto(link), url }, { status: 201 });
});

caseRouter.get("/:caseId/upload-links", validate({ params: caseParams }), async (req, res) => {
  const links = await caseService.listUploadLinks(req.user, req.valid.params.caseId);
  ok(res, links.map(toUploadLinkDto));
});

caseRouter.delete(
  "/:caseId/upload-links/:linkId",
  validate({ params: caseParams.extend({ linkId: objectId }) }),
  async (req, res) => {
    const { caseId, linkId } = req.valid.params;
    await caseService.revokeUploadLink(req.user, caseId, linkId, ctx(req));
    ok(res, null, { message: "Upload link revoked" });
  }
);

caseRouter.get(
  "/:caseId/sources",
  validate({ params: caseParams, query: listSourcesQuery }),
  async (req, res) => {
    const { caseId } = req.valid.params;
    await caseService.getOwnedCase(req.user, caseId);
    const { items, total } = await sourceService.listSources(caseId, req.valid.query);
    ok(res, pageOf(items.map(toSourceDto), total, req.valid.query));
  }
);

caseRouter.post(
  "/:caseId/sources",
  limiter(15, 60),
  validate({ params: caseParams }),
  async (req, _res, next) => {
    await caseService.getOwnedCase(req.user, req.valid.params.caseId); // before buffering any upload
    next();
  },
  acceptFiles,
  validate({ body: noteBody }),
  async (req, res) => {
    const { saved, duplicates } = await sourceService.addSources(
      req.valid.params.caseId,
      { type: "doctor", userId: req.user.id },
      { files: req.files, note: req.valid.body.note },
      ctx(req)
    );
    ok(res, { sources: saved.map(toSourceDto), duplicates }, { status: 201 });
  }
);


// re-run extraction + AI structuring (e.g. after a failure or once an API key is configured)
caseRouter.post(
  "/:caseId/sources/:sourceId/reprocess",
  limiter(15, 30),
  validate({ params: caseParams.extend({ sourceId: objectId }) }),
  async (req, res) => {
    const { caseId, sourceId } = req.valid.params;
    await caseService.getOwnedCase(req.user, caseId);
    const { matchedCount } = await requeueSource(sourceId, caseId);
    if (!matchedCount) throw notFound("Source not found or already queued");
    await recordAudit("source.reprocess", { actorId: req.user.id, ...ctx(req), meta: { caseId, sourceId } });
    ok(res, null, { status: 202, message: "Queued for processing" });
  }
);

// ---------- access to the patient's own health record ----------

const accessBody = z.strictObject({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) });

caseRouter.get("/:caseId/record-access", validate({ params: caseParams }), async (req, res) => {
  const { caseDoc, share } = await records.getAccessForCase(req.user, req.valid.params.caseId);
  ok(res, { linkedPatient: Boolean(caseDoc.linkedPatientId), share: share ? toShareForDoctorDto(share) : null });
});

// the same answer whether or not the email has a patient account: no probing for patients
caseRouter.post("/:caseId/record-access", limiter(60, 20), validate({ params: caseParams, body: accessBody }), async (req, res) => {
  const share = await records.requestAccess(req.user, req.valid.params.caseId, req.valid.body.email, ctx(req));
  ok(res, toShareForDoctorDto(share), { status: 201, message: "Request sent. The patient decides whether to share." });
});

caseRouter.delete("/:caseId/record-access", validate({ params: caseParams }), async (req, res) => {
  await records.withdrawAccess(req.user, req.valid.params.caseId, ctx(req));
  ok(res, null, { message: "Access withdrawn" });
});
