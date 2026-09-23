import { unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "../modules/auth/tokens.js";

export async function authenticate(req, _res, next) {
  const [scheme, token] = req.headers.authorization?.split(" ") ?? [];
  if (scheme !== "Bearer" || !token) throw unauthorized();
  try {
    req.user = await verifyAccessToken(token);
  } catch {
    throw unauthorized("Invalid or expired token");
  }
  next();
}
