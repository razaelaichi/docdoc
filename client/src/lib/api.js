import { reportApi } from "./telemetry.js";

// Access token lives only in memory (not localStorage) so injected scripts can't read it from storage.
// The refresh token is an HttpOnly cookie the browser sends to /api/v1/auth only.
let accessToken = null;
let refreshing = null;
let onExpired = () => {};

export class ApiError extends Error {
  constructor(status, error, requestId) {
    super(error?.message ?? "Something went wrong, please try again");
    this.status = status;
    this.code = error?.code;
    this.issues = error?.details?.issues;
    this.requestId = requestId; // shown to the user as a support reference; matches the server log line
  }
}

// Only relative API paths: a value that reached here from data can't redirect the request
// to another host ("//evil.example") or climb out of /api/v1 ("../").
const SAFE_PATH = /^\/(?!\/)[\w\-./?=&%+~]*$/;
function assertApiPath(path) {
  if (!SAFE_PATH.test(path) || path.includes("..")) throw new Error("Refusing to request an unsafe API path");
}

async function parse(res, requestId) {
  const body = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok || !body?.success) throw new ApiError(res.status, body?.error, body?.requestId ?? res.headers.get("x-request-id") ?? requestId);
  return body.data;
}

// Every request carries its own id; the API logs it, so one id links the browser report,
// the API log line, and any agent/database work done for that request.
async function send(path, { method = "GET", headers = {}, body, signal } = {}) {
  assertApiPath(path);
  const requestId = crypto.randomUUID();
  const started = performance.now();
  try {
    const res = await fetch(`/api/v1${path}`, {
      method,
      headers: { ...headers, "X-Request-Id": requestId },
      body,
      signal,
      credentials: "same-origin",
    });
    reportApi({ method, path, status: res.status, duration: performance.now() - started, requestId });
    return { res, requestId };
  } catch (err) {
    if (err.name === "AbortError") throw err; // superseded by a newer request: not a failure
    reportApi({ method, path, status: 0, duration: performance.now() - started, requestId });
    throw new ApiError(0, { code: "NETWORK", message: "Could not reach DocDoc. Check your connection and try again." }, requestId);
  }
}

export const setAccessToken = (token) => {
  accessToken = token;
};

export const onSessionExpired = (callback) => {
  onExpired = callback;
};

// One refresh in flight at a time: the server treats a reused refresh token as theft.
export function refreshSession() {
  refreshing ??= send("/auth/refresh", { method: "POST" })
    .then(({ res, requestId }) => parse(res, requestId))
    .then((session) => {
      accessToken = session.accessToken;
      return session;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api(path, { method = "GET", json, form, headers = {}, raw = false, signal } = {}, retry = true) {
  const { res, requestId } = await send(path, {
    method,
    signal,
    headers: {
      ...headers,
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      ...(json && { "Content-Type": "application/json" }),
    },
    body: form ?? (json && JSON.stringify(json)),
  });

  // a 401 from /auth itself (wrong password, bad reset token) is an answer, not an expired session
  if (res.status === 401 && retry && accessToken && !path.startsWith("/auth/")) {
    try {
      await refreshSession(); // access token expired: renew once, then retry
    } catch (err) {
      accessToken = null;
      onExpired(); // session is gone (revoked, expired, signed out elsewhere)
      throw err;
    }
    return api(path, { method, json, form, headers, raw, signal }, false);
  }
  if (raw && res.ok) return res;
  return parse(res, requestId);
}
