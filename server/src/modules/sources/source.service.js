import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { AppError, notFound, validationFailed } from "../../lib/errors.js";
import { deleteObject, putObject, readObjectStream } from "../../lib/storage.js";
import { recordAudit } from "../audit/audit.service.js";
import * as sources from "./source.repository.js";

// medical documents and images only; detected from magic bytes
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/tiff",
  "application/dicom",
]);

const displayName = (name) =>
  // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
  path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "file";

/**
 * Stores a batch of files and/or a note for a case.
 * All files are validated before any is stored, so a bad file rejects the whole batch.
 */
export async function addSources(caseId, uploader, { files = [], note }, ctx) {
  if (!files.length && !note) throw validationFailed([{ field: "body", message: "Attach a file or write a note" }]);

  const checked = await Promise.all(
    files.map(async (f) => {
      const type = await fileTypeFromBuffer(f.buffer);
      if (!type || !ALLOWED_TYPES.has(type.mime)) {
        throw new AppError(415, "UNSUPPORTED_FILE_TYPE", "Only PDF, images and DICOM files are accepted", {
          file: displayName(f.originalname),
        });
      }
      return { ...f, type, sha256: createHash("sha256").update(f.buffer).digest("hex") };
    })
  );

  const saved = [];
  const duplicates = [];
  const base = { caseId, uploadedBy: uploader.type, uploaderId: uploader.userId };

  if (note) saved.push(await sources.createSource({ ...base, kind: "note", note }));

  for (const f of checked) {
    const storageKey = `${randomUUID()}.${f.type.ext}`;
    await putObject(storageKey, f.buffer); // write first: a crash leaves an orphan file, never a dangling record
    try {
      saved.push(
        await sources.createSource({
          ...base,
          kind: "file",
          file: { originalName: displayName(f.originalname), storageKey, mimeType: f.type.mime, size: f.size, sha256: f.sha256 },
        })
      );
    } catch (err) {
      await deleteObject(storageKey);
      if (err.code !== 11000) throw err;
      duplicates.push(displayName(f.originalname));
    }
  }

  await recordAudit("source.upload", {
    actorId: uploader.userId,
    ...ctx,
    meta: { ...ctx.meta, caseId, uploadedBy: uploader.type, count: saved.length, duplicates: duplicates.length },
  });
  return { saved, duplicates };
}

export async function addQuestionnaire(caseId, questionnaire, ctx) {
  const saved = await sources.createSource({ caseId, uploadedBy: "patient", kind: "questionnaire", questionnaire, uploaderId: ctx.actorId });
  await recordAudit("source.upload", { ...ctx, meta: { ...ctx.meta, caseId, uploadedBy: "patient", kind: "questionnaire" } });
  return saved;
}

export const listSources = (caseId, query) => sources.listSources(caseId, query);

export async function openSourceFile(caseId, sourceId, actorId, { via, ...ctx }) {
  const source = await sources.findSource(sourceId, caseId);
  if (!source?.file?.storageKey) throw notFound("File not found");
  await recordAudit("source.download", { actorId, ...ctx, meta: { caseId, sourceId, via } }); // PHI access trail
  return { file: source.file, stream: readObjectStream(source.file.storageKey) };
}
