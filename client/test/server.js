import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// A fake API for integration tests: same envelope and status codes as the real server.
export const ok = (data, init) => HttpResponse.json({ success: true, data, requestId: "req-test-0001" }, init);
export const fail = (status, code, message, extra = {}) =>
  HttpResponse.json({ success: false, error: { code, message, ...extra }, requestId: "req-test-0002" }, { status });

export const DOCTOR = { id: "u1", name: "Dr Asha Menon", email: "asha@example.com", role: "doctor" };

export const handlers = [
  http.post("*/api/v1/auth/refresh", () => fail(401, "UNAUTHORIZED", "No session")),
  http.get("*/api/v1/flags", () => ok({ "record-contents": true, "intent-prefetch": true, "keyboard-shortcuts": true })),
  http.post("*/api/v1/telemetry", () => new HttpResponse(null, { status: 204 })),
];

export const server = setupServer(...handlers);
export { http, HttpResponse };
