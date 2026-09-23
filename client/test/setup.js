import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { setAccessToken } from "../src/lib/api.js";
import { server } from "./server.js";

// jsdom has no modal dialog support yet (node-environment suites have no DOM at all)
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function close() {
    this.removeAttribute("open");
  };
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  setAccessToken(null); // the token lives in module memory, like in the browser
  server.resetHandlers();
});
afterAll(() => server.close());
