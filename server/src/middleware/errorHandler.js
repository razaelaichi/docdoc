import { AppError, notFound } from "../lib/errors.js";

// body-parser errors are client mistakes, map them instead of reporting 500
const BODY_ERRORS = {
  "entity.parse.failed": [400, "INVALID_JSON", "Request body is not valid JSON"],
  "entity.too.large": [413, "PAYLOAD_TOO_LARGE", "Request body is too large"],
};

const MULTER_ERRORS = {
  LIMIT_FILE_SIZE: [413, "FILE_TOO_LARGE", "A file exceeds the 15 MB limit"],
  LIMIT_FILE_COUNT: [400, "TOO_MANY_FILES", "At most 10 files per upload"],
};

export const notFoundHandler = (_req, _res, next) => next(notFound("Route not found"));

// eslint-disable-next-line no-unused-vars -- express identifies error handlers by arity
export function errorHandler(err, req, res, _next) {
  let error = err instanceof AppError ? err : null;
  if (!error && BODY_ERRORS[err.type]) error = new AppError(...BODY_ERRORS[err.type]);
  if (!error && err.name === "MulterError") {
    error = new AppError(...(MULTER_ERRORS[err.code] ?? [400, "INVALID_UPLOAD", "Invalid upload"]));
  }
  if (!error) {
    req.log.error({ err }, "unhandled error"); // full detail stays in logs only
    error = new AppError(500, "INTERNAL_ERROR", "Something went wrong");
  }

  res.status(error.status).json({
    success: false,
    error: { code: error.code, message: error.message, details: error.details },
    requestId: req.id,
  });
}
