// Access token lives only in memory (not localStorage) so injected scripts can't read it from storage.
// The refresh token is an HttpOnly cookie the browser sends to /api/v1/auth only.
let accessToken = null;
let refreshing = null;
let onExpired = () => {};

export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message ?? "Something went wrong, please try again");
    this.status = status;
    this.code = error?.code;
    this.issues = error?.details?.issues;
  }
}

async function parse(res) {
  const body = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok || !body?.success) throw new ApiError(res.status, body?.error);
  return body.data;
}

export const setAccessToken = (token) => {
  accessToken = token;
};

export const onSessionExpired = (callback) => {
  onExpired = callback;
};

// One refresh in flight at a time: the server treats a reused refresh token as theft.
export function refreshSession() {
  refreshing ??= fetch("/api/v1/auth/refresh", { method: "POST" })
    .then(parse)
    .then((session) => {
      accessToken = session.accessToken;
      return session;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api(path, { method = "GET", json, form, headers = {}, raw = false } = {}, retry = true) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...headers,
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      ...(json && { "Content-Type": "application/json" }),
    },
    body: form ?? (json && JSON.stringify(json)),
  });

  if (res.status === 401 && retry && accessToken) {
    try {
      await refreshSession(); // access token expired: renew once, then retry
    } catch (err) {
      accessToken = null;
      onExpired(); // session is gone (revoked, expired, signed out elsewhere)
      throw err;
    }
    return api(path, { method, json, form, headers, raw }, false);
  }
  if (raw && res.ok) return res;
  return parse(res);
}
