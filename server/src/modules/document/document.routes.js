import { Router } from "express";
import { z } from "zod";
import { notFound } from "../../lib/errors.js";
import { objectId } from "../../lib/ids.js";
import { limiter } from "../../lib/rateLimit.js";
import { ok } from "../../lib/respond.js";
import { validate } from "../../middleware/validate.js";
import { recordAudit } from "../audit/audit.service.js";
import { openSourceFile } from "../sources/source.service.js";
import { compileCase } from "./compile.js";
import { getSourceText, loadPdfAssets } from "./document.service.js";
import { toFhirBundle } from "./fhir.js";
import { writePdf } from "./pdf.js";

const sourceParams = z.looseObject({ sourceId: objectId }); // the mount point adds its own params
const filename = (doc, ext) => `record-${doc.case.id}.${ext}`;

/**
 * The compiled record and its sources, for whichever record `resolve(req)` grants access to:
 * a doctor's own case, a patient's own health record, or a record a patient shared with a doctor.
 * `resolve` does the access check and returns { record, via }; nothing here trusts a URL id.
 */
export function documentRoutes(resolve) {
  const router = Router({ mergeParams: true });
  const audit = (req, action, record, via, meta) =>
    recordAudit(action, { actorId: req.user.id, ip: req.ip, requestId: req.id, meta: { caseId: record._id, via, ...meta } });

  async function compiled(req, action, format) {
    const { record, via } = await resolve(req);
    const doc = await compileCase(record);
    await audit(req, action, record, via, { format });
    return doc;
  }

  router.get("/document", async (req, res) => {
    ok(res, await compiled(req, "document.view"));
  });

  router.get("/document/pdf", limiter(15, 10), async (req, res) => {
    const doc = await compiled(req, "document.export", "pdf");
    const assets = await loadPdfAssets(doc.case.id, doc);
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename(doc, "pdf")}"` });
    writePdf(doc, assets, res);
  });

  router.get("/document/fhir", limiter(15, 20), async (req, res) => {
    const doc = await compiled(req, "document.export", "fhir");
    res.set("Content-Disposition", `attachment; filename="${filename(doc, "fhir.json")}"`);
    res.type("application/fhir+json").send(JSON.stringify(toFhirBundle(doc)));
  });

  // the citation viewer: full text of one source, to show a quote in context
  router.get("/sources/:sourceId/text", validate({ params: sourceParams }), async (req, res) => {
    const { record, via } = await resolve(req);
    const text = await getSourceText(record._id, req.valid.params.sourceId);
    if (!text) throw notFound("No extracted text for this source yet");
    await audit(req, "source.view_text", record, via, { sourceId: req.valid.params.sourceId });
    ok(res, { pages: text.pages });
  });

  router.get("/sources/:sourceId/file", validate({ params: sourceParams }), async (req, res) => {
    const { record, via } = await resolve(req);
    const { file, stream } = await openSourceFile(record._id, req.valid.params.sourceId, req.user.id, {
      ip: req.ip,
      requestId: req.id,
      via,
    });
    res.set({
      "Content-Type": file.mimeType,
      "Content-Length": file.size,
      // attachment: the browser never renders an uploaded file in our origin
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    });
    stream.pipe(res);
  });

  return router;
}
