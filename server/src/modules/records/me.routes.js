import { Router } from "express";
import { z } from "zod";
import { objectId } from "../../lib/ids.js";
import { pageOf, paginationQuery } from "../../lib/pagination.js";
import { limiter } from "../../lib/rateLimit.js";
import { ok } from "../../lib/respond.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/authorize.js";
import { acceptFiles } from "../../middleware/upload.js";
import { validate } from "../../middleware/validate.js";
import { documentRoutes } from "../document/document.routes.js";
import { questionnaireBody } from "../intake/intake.routes.js";
import { toSourceDto } from "../sources/source.dto.js";
import * as sourceService from "../sources/source.service.js";
import { Case } from "../cases/case.model.js";
import { toPersonalRecordDto, toShareForPatientDto } from "./records.dto.js";
import * as records from "./records.service.js";

// The patient's own space. Every query here is scoped to the signed-in patient's record:
// there is no id in these URLs that could point at someone else's data.
export const meRouter = Router();
meRouter.use(authenticate, requireRole("patient"));

const ctx = (req) => ({ ip: req.ip, requestId: req.id });
const listSourcesQuery = paginationQuery(["createdAt"], "-createdAt");
const noteBody = z.strictObject({ note: z.string().trim().max(10_000).optional() });
const tokenBody = z.strictObject({ token: z.string().regex(/^[\w-]{20,64}$/) }); // in the body: never in a logged URL
const shareParams = z.strictObject({ shareId: objectId });

const ownRecord = async (req) => ({ record: await records.getPersonalRecord(req.user), via: "own-record" });
meRouter.use("/record", documentRoutes(ownRecord));

meRouter.get("/record", async (req, res) => {
  const record = await records.getPersonalRecord(req.user);
  const [{ total }, shares, linkedVisits] = await Promise.all([
    sourceService.listSources(record._id, { page: 1, limit: 1, sort: "-createdAt" }),
    records.listShares(req.user),
    Case.countDocuments({ linkedPatientId: req.user.id, kind: "clinical" }),
  ]);
  ok(
    res,
    toPersonalRecordDto(record, {
      total,
      linkedVisits,
      activeShares: shares.filter((s) => s.status === "active").length,
      pendingRequests: shares.filter((s) => s.status === "pending").length,
    })
  );
});

meRouter.get("/record/sources", validate({ query: listSourcesQuery }), async (req, res) => {
  const record = await records.getPersonalRecord(req.user);
  const { items, total } = await sourceService.listSources(record._id, req.valid.query);
  ok(res, pageOf(items.map(toSourceDto), total, req.valid.query));
});

// only new documents: a file already in the record (by content) is skipped and reported
meRouter.post(
  "/record/sources",
  limiter(15, 60),
  async (req, _res, next) => {
    req.record = await records.getPersonalRecord(req.user); // before buffering any upload
    next();
  },
  acceptFiles,
  validate({ body: noteBody }),
  async (req, res) => {
    const { saved, duplicates } = await sourceService.addSources(
      req.record._id,
      { type: "patient", userId: req.user.id },
      { files: req.files, note: req.valid.body.note },
      ctx(req)
    );
    ok(res, { sources: saved.map(toSourceDto), received: saved.length, duplicates }, { status: 201 });
  }
);

meRouter.post("/record/questionnaire", limiter(15, 20), validate({ body: questionnaireBody }), async (req, res) => {
  const record = await records.getPersonalRecord(req.user);
  await sourceService.addQuestionnaire(record._id, req.valid.body, { actorId: req.user.id, ...ctx(req) });
  ok(res, null, { status: 201, message: "Saved to your health record" });
});

// a doctor's upload link, opened while signed in: link the visit and copy it into the record
meRouter.post("/links", limiter(15, 30), validate({ body: tokenBody }), async (req, res) => {
  ok(res, await records.claimLink(req.user, req.valid.body.token, ctx(req)));
});

meRouter.post("/links/share", limiter(15, 30), validate({ body: tokenBody }), async (req, res) => {
  const share = await records.shareWithLinkDoctor(req.user, req.valid.body.token, ctx(req));
  ok(res, { id: String(share._id), status: share.status }, { message: "Your health record is shared with this doctor" });
});

meRouter.get("/shares", async (req, res) => {
  ok(res, (await records.listShares(req.user)).map(toShareForPatientDto));
});

meRouter.post("/shares/:shareId/approve", validate({ params: shareParams }), async (req, res) => {
  await records.approve(req.user, req.valid.params.shareId, ctx(req));
  ok(res, null, { message: "Access granted" });
});

meRouter.post("/shares/:shareId/decline", validate({ params: shareParams }), async (req, res) => {
  await records.decline(req.user, req.valid.params.shareId, ctx(req));
  ok(res, null, { message: "Request declined" });
});

meRouter.post("/shares/:shareId/revoke", validate({ params: shareParams }), async (req, res) => {
  await records.revoke(req.user, req.valid.params.shareId, ctx(req));
  ok(res, null, { message: "Access removed" });
});
