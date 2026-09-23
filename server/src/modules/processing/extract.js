import dicomParser from "dicom-parser";
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { AppError } from "../../lib/errors.js";
import { ocr } from "./ocr.js";

const MAX_PDF_PAGES = 300; // bounds worker time per document
const OCR_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const unsupported = (message) => new AppError(422, "UNSUPPORTED_CONTENT", message);

async function fromPdf(buffer) {
  // pdf.js takes ownership of (detaches) the bytes; everything below works from `doc`
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  if (doc.numPages > MAX_PDF_PAGES) throw unsupported(`PDF has more than ${MAX_PDF_PAGES} pages`);
  const { text } = await extractText(doc, { mergePages: false });

  const pages = [];
  for (const [i, pageText] of text.entries()) {
    if (pageText.trim()) {
      pages.push({ page: i + 1, text: pageText, method: "text-layer" });
      continue;
    }
    // no text layer: the page is a scanned image, so OCR it
    const image = await renderPageAsImage(doc, i + 1, { canvasImport: () => import("@napi-rs/canvas"), scale: 2 });
    pages.push({ page: i + 1, method: "ocr", ...(await ocr(Buffer.from(image))) });
  }
  return pages;
}

// Only descriptive study tags; patient identifiers inside the file are deliberately not copied.
const DICOM_TAGS = {
  x00080060: "Modality",
  x00180015: "Body part",
  x00080020: "Study date",
  x00081030: "Study description",
  x0008103e: "Series description",
};

function fromDicom(buffer) {
  let dataSet;
  try {
    dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
  } catch {
    throw unsupported("DICOM file could not be read");
  }
  const lines = Object.entries(DICOM_TAGS)
    .map(([tag, label]) => [label, dataSet.string(tag)?.trim()])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
  return [{ page: 1, text: lines.join("\n"), method: "metadata" }];
}

/** Turns one stored file into text pages. */
export async function extractFile(buffer, mimeType) {
  if (mimeType === "application/pdf") return fromPdf(buffer);
  if (mimeType === "application/dicom") return fromDicom(buffer);
  if (OCR_IMAGE_TYPES.has(mimeType)) return [{ page: 1, method: "ocr", ...(await ocr(buffer)) }];
  throw unsupported(`Text extraction is not available for ${mimeType} files yet`);
}
