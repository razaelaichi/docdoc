import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, onSessionExpired, refreshSession, setAccessToken } from "../src/lib/api.js";
import { fail, http, HttpResponse, ok, server } from "./server.js";

beforeEach(() => setAccessToken(null));

describe("api client", () => {
  it("sends a request id and the bearer token, and unwraps the envelope", async () => {
    let seen;
    server.use(
      http.get("*/api/v1/cases/abc", ({ request }) => {
        seen = request.headers;
        return ok({ id: "abc" });
      })
    );
    setAccessToken("tok");
    await expect(api("/cases/abc")).resolves.toEqual({ id: "abc" });
    expect(seen.get("authorization")).toBe("Bearer tok");
    expect(seen.get("x-request-id")).toMatch(/^[\w-]{36}$/);
  });

  it("refuses paths that could leave the API", async () => {
    await expect(api("//evil.example/x")).rejects.toThrow(/unsafe API path/);
    await expect(api("/cases/../../admin")).rejects.toThrow(/unsafe API path/);
    await expect(api("https://evil.example")).rejects.toThrow(/unsafe API path/);
  });

  it("turns error envelopes into ApiError with issues and the server's request id", async () => {
    server.use(http.post("*/api/v1/cases", () => fail(422, "VALIDATION", "Invalid", { details: { issues: [{ field: "body.patientName", message: "Required" }] } })));
    const err = await api("/cases", { method: "POST", json: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: "VALIDATION", requestId: "req-test-0002" });
    expect(err.issues).toEqual([{ field: "body.patientName", message: "Required" }]);
  });

  it("reports a network failure as status 0 with a helpful message", async () => {
    server.use(http.get("*/api/v1/cases", () => HttpResponse.error()));
    const err = await api("/cases").catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: "NETWORK" });
    expect(err.message).toMatch(/Could not reach DocDoc/);
  });

  it("lets an aborted request reject with AbortError, not an API failure", async () => {
    server.use(http.get("*/api/v1/cases", () => new Promise(() => {})));
    const controller = new AbortController();
    const pending = api("/cases", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("refreshes an expired access token once and retries the request", async () => {
    let refreshes = 0;
    server.use(
      http.post("*/api/v1/auth/refresh", () => (refreshes++, ok({ accessToken: "new", user: {} }))),
      http.get("*/api/v1/cases", ({ request }) =>
        request.headers.get("authorization") === "Bearer new" ? ok({ items: [] }) : fail(401, "UNAUTHORIZED", "Expired")
      )
    );
    setAccessToken("old");
    // two requests fail at once: only one refresh may be sent (a reused refresh token is treated as theft)
    await Promise.all([api("/cases"), api("/cases")]);
    expect(refreshes).toBe(1);
  });

  it("signals session expiry when the refresh is refused", async () => {
    const expired = vi.fn();
    onSessionExpired(expired);
    server.use(http.get("*/api/v1/cases", () => fail(401, "UNAUTHORIZED", "Expired")));
    setAccessToken("old");
    await expect(api("/cases")).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledOnce();
  });

  it("shares one in-flight refresh", async () => {
    server.use(http.post("*/api/v1/auth/refresh", () => ok({ accessToken: "t", user: {} })));
    const a = refreshSession();
    expect(refreshSession()).toBe(a);
    await a;
  });
});
