import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocumentProxy, renderPageAsImage } from "unpdf";
import { getObject } from "../../lib/storage.js";
import { SourceText } from "../processing/sourceText.model.js";
import { Source } from "../sources/source.model.js";

const MAX_EMBEDDED_IMAGES = 60; // bounds memory and PDF size

// pdfkit embeds JPEG/PNG only; other image types are re-encoded as PNG
async function embeddable(buffer, mimeType) {
  if (mimeType === "image/jpeg" || mimeType === "image/png") return buffer;
  const img = await loadImage(buffer);
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas.toBuffer("image/png");
}

/** Loads what the PDF needs beyond the compiled JSON: images, cited PDF pages, full texts. */
export async function loadPdfAssets(caseId, doc) {
  const imaging = doc.sections.find((s) => s.key === "imaging_finding");
  const sources = new Map(
    (await Source.find({ caseId }).select("file").lean()).map((s) => [String(s._id), s])
  );

  const images = new Map();
  for (const img of imaging.images.slice(0, MAX_EMBEDDED_IMAGES)) {
    const file = sources.get(img.sourceId).file;
    images.set(img.sourceId, await embeddable(await getObject(file.storageKey), file.mimeType).catch(() => null));
  }

  const pages = new Map();
  for (const p of imaging.renderedPages.slice(0, MAX_EMBEDDED_IMAGES)) {
    const pdf = await getDocumentProxy(new Uint8Array(await getObject(sources.get(p.sourceId).file.storageKey)));
    const png = await renderPageAsImage(pdf, p.page, { canvasImport: () => import("@napi-rs/canvas"), scale: 1.5 });
    pages.set(`${p.sourceId}:${p.page}`, Buffer.from(png));
  }

  const textBySource = new Map(
    (await SourceText.find({ caseId }).lean()).map((t) => [String(t.sourceId), t.pages])
  );
  const texts = doc.sources.map((s) => ({ ref: s.ref, name: s.name, pages: textBySource.get(s.id) ?? [] }));

  return { images, pages, texts };
}

export const getSourceText = (caseId, sourceId) => SourceText.findOne({ caseId, sourceId }).lean();
