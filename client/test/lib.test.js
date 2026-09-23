import { describe, expect, it } from "vitest";
import { fieldProps } from "../src/lib/fieldProps.js";
import { formatDate, initials, plural } from "../src/lib/format.js";
import { apiTemplate, pageTemplate, scrub } from "../src/lib/routes.js";
import { safeInternalPath } from "../src/lib/safeRedirect.js";

describe("safeInternalPath", () => {
  it.each([
    ["/cases/abc", "/cases/abc"],
    ["/cases?search=x#top", "/cases?search=x#top"],
    ["//evil.example/login", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["", "/"],
    [undefined, "/"],
    [{ pathname: "/x" }, "/"],
  ])("%s -> %s", (input, expected) => {
    expect(safeInternalPath(input)).toBe(expected);
  });
});

describe("route templates", () => {
  it("replaces ids and upload tokens so they never reach telemetry", () => {
    expect(pageTemplate("/cases/6ab388c30b5d4ad973843316/record")).toBe("/cases/:id/record");
    expect(pageTemplate("/intake/v52GS9ReDm4HfK9lBjkLuoFEx0RbqeEl")).toBe("/intake/:token");
    expect(pageTemplate("/somewhere/else")).toBe("other");
    expect(apiTemplate("/cases/6ab388c30b5d4ad973843316/sources/6ab388c30b5d4ad973843318/text")).toBe("/cases/:id/sources/:id/text");
    expect(apiTemplate("/intake/v52GS9ReDm4HfK9lBjkLuoFEx0RbqeEl/sources")).toBe("/intake/:token/sources");
    expect(apiTemplate("/cases?page=2&search=Arjun")).toBe("/cases");
  });

  it("scrubs personal data from error text", () => {
    expect(scrub("TypeError at /intake/abcdefghijklmnopqrstuvwx for asha@example.com, MRN 448210")).toBe(
      "TypeError at /intake/[token] for [email], MRN [n]"
    );
  });
});

describe("format", () => {
  it("builds initials and plurals", () => {
    expect(initials("Arjun  Malhotra")).toBe("AM");
    expect(initials("Cher")).toBe("C");
    expect(plural(1, "entry", "entries")).toBe("1 entry");
    expect(plural(3, "entry", "entries")).toBe("3 entries");
    expect(plural(2, "source")).toBe("2 sources");
    expect(formatDate("2026-09-30T00:00:00Z")).toMatch(/2026/);
  });
});

describe("fieldProps", () => {
  const error = { issues: [{ field: "body.password", message: "Too short" }] };
  it("links a field to the error and flags only the fields it names", () => {
    expect(fieldProps(null, "password", "e")).toEqual({});
    expect(fieldProps(error, "password", "e")).toEqual({ "aria-describedby": "e", "aria-invalid": true });
    expect(fieldProps(error, "email", "e")).toEqual({ "aria-describedby": "e" });
  });
});
