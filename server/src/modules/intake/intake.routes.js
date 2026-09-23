import { Router } from "express";
import { z } from "zod";
import { limiter } from "../../lib/rateLimit.js";
import { ok } from "../../lib/respond.js";
import { acceptFiles } from "../../middleware/upload.js";
import { validate } from "../../middleware/validate.js";
import { findCaseForUploadToken } from "../cases/case.service.js";
import { addQuestionnaire, addSources } from "../sources/source.service.js";

// Public endpoints for patients, authorised only by the upload-link token.
// Deliberately return nothing about the case: a leaked link must not leak data.
const tokenParams = z.strictObject({ token: z.string().regex(/^[\w-]{20,64}$/) });
const noteBody = z.strictObject({ note: z.string().trim().max(10_000).optional() });

const text = (max = 200) => z.string().trim().max(max);
const list = (item, max = 50) => z.array(item).max(max).default([]);
export const questionnaireBody = z
  .strictObject({
    allergies: list(
      z.strictObject({
        substance: text().min(1),
        reaction: text().optional(),
        severity: z.enum(["mild", "moderate", "severe", "unknown"]).default("unknown"),
      })
    ),
    medications: list(z.strictObject({ name: text().min(1), dose: text(100).optional(), frequency: text(100).optional() })),
    conditions: list(text().min(1)),
    surgeries: list(text().min(1)),
    familyHistory: text(5000).optional(),
    other: text(5000).optional(),
  })
  .refine((q) => Object.values(q).some((v) => (Array.isArray(v) ? v.length : v)), "The questionnaire is empty");

export const intakeRouter = Router();
intakeRouter.use(limiter(15, 30));

intakeRouter.get("/:token", validate({ params: tokenParams }), async (req, res) => {
  const link = await findCaseForUploadToken(req.valid.params.token);
  ok(res, { expiresAt: link.expiresAt });
});

intakeRouter.post("/:token/questionnaire", validate({ params: tokenParams, body: questionnaireBody }), async (req, res) => {
  const link = await findCaseForUploadToken(req.valid.params.token);
  await addQuestionnaire(link.caseId, req.valid.body, { ip: req.ip, requestId: req.id, meta: { linkId: link._id } });
  ok(res, null, { status: 201, message: "Thank you, your answers were received" });
});

intakeRouter.post(
  "/:token/sources",
  validate({ params: tokenParams }),
  async (req, _res, next) => {
    req.link = await findCaseForUploadToken(req.valid.params.token); // before buffering any upload
    next();
  },
  acceptFiles,
  validate({ body: noteBody }),
  async (req, res) => {
    const { saved, duplicates } = await addSources(
      req.link.caseId,
      { type: "patient" },
      { files: req.files, note: req.valid.body.note },
      { ip: req.ip, requestId: req.id, meta: { linkId: req.link._id } }
    );
    ok(res, { received: saved.length, duplicates }, { status: 201 });
  }
);
