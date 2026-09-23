import { validationFailed } from "../lib/errors.js";

// Parses each request part with its zod schema; handlers read only req.valid.*
// (req.query is read-only in Express 5, so parsed values live on req.valid)
export const validate = (schemas) => (req, _res, next) => {
  req.valid ??= {}; // routes may validate params before a multipart body, then the body
  for (const [part, schema] of Object.entries(schemas)) {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      throw validationFailed(
        result.error.issues.map((i) => ({ field: [part, ...i.path].join("."), message: i.message }))
      );
    }
    req.valid[part] = result.data;
  }
  next();
};
