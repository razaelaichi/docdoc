import { createRequire } from "node:module";
import path from "node:path";
import { createWorker } from "tesseract.js";

// English model shipped as an npm package: no runtime download from a CDN
const langPath = path.join(
  path.dirname(createRequire(import.meta.url).resolve("@tesseract.js-data/eng/package.json")),
  "4.0.0_best_int"
);

let worker;
export async function ocr(image) {
  worker ??= createWorker("eng", 1, { langPath, gzip: true, cacheMethod: "none" });
  const { data } = await (await worker).recognize(image);
  return { text: data.text, confidence: Math.round(data.confidence) };
}

export async function stopOcr() {
  if (worker) await (await worker).terminate();
  worker = undefined;
}
