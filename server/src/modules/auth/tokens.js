import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { config } from "../../config/index.js";

const key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
const ISSUER = "docdoc";
const AUDIENCE = "docdoc-api";

export const signAccessToken = (user) =>
  new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user._id))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_MIN}m`)
    .sign(key);

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
  return { id: payload.sub, role: payload.role };
}

// refresh tokens are opaque random strings; only their hash is stored
export const newRefreshToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token) => createHash("sha256").update(token).digest("hex");
