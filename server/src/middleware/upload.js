import multer from "multer";

// in-memory so bytes can be type-checked before anything touches disk;
// the limits bound worst-case memory per request
export const acceptFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10, fields: 5, fieldSize: 20_000, parts: 20 },
}).array("files", 10);
