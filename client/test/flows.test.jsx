import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Layout from "../src/components/Layout.jsx";
import CaseRecord from "../src/pages/CaseRecord.jsx";
import Cases from "../src/pages/Cases.jsx";
import Login from "../src/pages/Login.jsx";
import { renderApp } from "./render.jsx";
import { DOCTOR, fail, http, ok, server } from "./server.js";

const CASES = { items: [{ id: "6ab388c30b5d4ad973843316", patientName: "Arjun Malhotra", createdAt: "2026-09-23T08:00:00Z" }], total: 1, totalPages: 1 };
const doctorRoutes = [
  { path: "/login", Component: Login },
  { Component: Layout, children: [{ index: true, Component: Cases }, { path: "cases/:caseId/record", Component: CaseRecord }] },
];
const signInWorks = () =>
  server.use(
    http.post("*/api/v1/auth/login", async ({ request }) => {
      const { password } = await request.json();
      return password === "right-password-123" ? ok({ user: DOCTOR, accessToken: "tok" }) : fail(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }),
    http.get("*/api/v1/cases", () => ok(CASES))
  );

async function signIn(user, password = "right-password-123") {
  await user.type(await screen.findByLabelText("Email"), DOCTOR.email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("sign in", () => {
  it("signs in, lands on the cases list, moves focus to the page and announces it", async () => {
    signInWorks();
    const user = userEvent.setup();
    renderApp(doctorRoutes, { at: "/login" });
    await signIn(user);
    expect(await screen.findByRole("link", { name: "Arjun Malhotra" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "main"));
    await waitFor(() => expect(document.title).toBe("Cases · DocDoc"));
  });

  it("shows a wrong-password error tied to the fields", async () => {
    signInWorks();
    const user = userEvent.setup();
    renderApp(doctorRoutes, { at: "/login" });
    await signIn(user, "wrong-password-123");
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-describedby", "login-error");
  });

  it("never follows an off-site redirect after sign in", async () => {
    signInWorks();
    const user = userEvent.setup();
    const { router } = renderApp(doctorRoutes, { at: { pathname: "/login", state: { from: "//evil.example/phish" } } });
    await signIn(user);
    await screen.findByRole("link", { name: "Arjun Malhotra" });
    expect(router.state.location.pathname).toBe("/");
  });

  it("returns to the page the doctor was on when the session is restored", async () => {
    signInWorks();
    const user = userEvent.setup();
    const { router } = renderApp(doctorRoutes, { at: { pathname: "/login", state: { from: "/?search=Arjun" } } });
    await signIn(user);
    await waitFor(() => expect(router.state.location.search).toBe("?search=Arjun"));
  });
});

describe("session expiry", () => {
  it("sends the doctor to sign in with an explanation when the session can't be renewed", async () => {
    let refreshes = 0;
    server.use(
      http.post("*/api/v1/auth/refresh", () => (++refreshes === 1 ? ok({ user: DOCTOR, accessToken: "tok" }) : fail(401, "UNAUTHORIZED", "Session revoked"))),
      http.get("*/api/v1/cases", () => fail(401, "UNAUTHORIZED", "Expired"))
    );
    renderApp(doctorRoutes, { at: "/" });
    expect(await screen.findByText(/Your session has ended/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("keeps the expired-session explanation across the redirect to sign in", async () => {
    sessionStorage.setItem("docdoc:auth-reason", "expired");
    renderApp(doctorRoutes, { at: "/login" });
    expect(await screen.findByText(/Your session has ended/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    sessionStorage.removeItem("docdoc:auth-reason");
  });
});

describe("cases list", () => {
  it("focuses search with Ctrl/Cmd+K", async () => {
    server.use(http.post("*/api/v1/auth/refresh", () => ok({ user: DOCTOR, accessToken: "tok" })), http.get("*/api/v1/cases", () => ok(CASES)));
    const user = userEvent.setup();
    renderApp(doctorRoutes, { at: "/" });
    await screen.findByRole("link", { name: "Arjun Malhotra" });
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("searchbox", { name: "Search by patient name" })).toHaveFocus();
  });
});

const fact = (id, label, quote, extra = {}) => ({ id, label, value: quote.split(": ")[1], date: "", quote, origin: "document", citation: { ref: "S1", page: 1, sourceId: "s1", quote }, ...extra });
const DOC = {
  case: { patientName: "Arjun Malhotra" },
  generatedAt: "2026-09-23T08:00:00Z",
  sources: [{ id: "s1", ref: "S1", name: "discharge.pdf", kind: "file", uploadedBy: "doctor", uploadedAt: "2026-09-23T08:00:00Z", status: "done", pages: 1, factCount: 2, uncoveredPages: [], error: null }],
  completeness: { pending: [], failed: [], notStructured: [] },
  alerts: {
    allergies: [fact("f1", "Penicillin", "Allergy: Penicillin - rash")],
    conflicts: [{ message: 'Medication "Amoxicillin" matches recorded allergy "Penicillin"', factIds: ["f1", "f2"] }],
  },
  sections: [{ key: "medication", title: "Medications", facts: [fact("f2", "Amoxicillin", "Amoxicillin: 500 mg", { flag: "above" })], images: [] }],
};

describe("compiled record", () => {
  it("shows alerts and opens a citation with the quote highlighted, returning focus on close", async () => {
    server.use(
      http.post("*/api/v1/auth/refresh", () => ok({ user: DOCTOR, accessToken: "tok" })),
      http.get("*/api/v1/cases/:id/document", () => ok(DOC)),
      http.get("*/api/v1/cases/:id/sources/:sid/text", () => ok({ pages: [{ page: 1, method: "text", text: "Header\nAllergy: Penicillin - rash\nFooter" }] }))
    );
    const user = userEvent.setup();
    renderApp(doctorRoutes, { at: "/cases/6ab388c30b5d4ad973843316/record" });

    const alerts = await screen.findByRole("region", { name: "Critical alerts" });
    expect(within(alerts).getByText(/matches recorded allergy "Penicillin" \(analyser\)/)).toBeInTheDocument();
    expect(screen.getByText("above printed range (analyser)")).toBeInTheDocument();

    const cite = within(screen.getByRole("row", { name: /Penicillin/ })).getByRole("link", { name: "[S1 p.1]" });
    await user.click(cite);
    const dialog = await screen.findByRole("dialog", { name: "discharge.pdf" });
    expect(await within(dialog).findByText("Allergy: Penicillin - rash", { selector: "mark" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cite).toHaveFocus();
    expect(document.title).toBe("Compiled record · Arjun Malhotra · DocDoc");
  });

  it("hides the contents list when its feature flag is off", async () => {
    server.use(
      http.post("*/api/v1/auth/refresh", () => ok({ user: DOCTOR, accessToken: "tok" })),
      http.get("*/api/v1/flags", () => ok({ "record-contents": false, "intent-prefetch": true, "keyboard-shortcuts": true })),
      http.get("*/api/v1/cases/:id/document", () => ok(DOC))
    );
    renderApp(doctorRoutes, { at: "/cases/6ab388c30b5d4ad973843316/record" });
    await screen.findByRole("region", { name: "Critical alerts" });
    await waitFor(() => expect(screen.queryByRole("navigation", { name: "Record sections" })).not.toBeInTheDocument());
  });
});

describe("error boundary", () => {
  it("replaces a crashed page with a recoverable error screen", async () => {
    const Broken = () => {
      throw new Error("render failed");
    };
    renderApp([{ index: true, Component: Broken }]);
    expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
  });

  it("shows a not-found page for unknown addresses", async () => {
    renderApp([{ index: true, Component: () => null }], { at: "/no/such/page" });
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
