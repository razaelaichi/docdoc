import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Layout from "../src/components/Layout.jsx";
import Cases from "../src/pages/Cases.jsx";
import Intake from "../src/pages/Intake.jsx";
import PatientDashboard from "../src/pages/patient/Dashboard.jsx";
import PatientLogin from "../src/pages/patient/Login.jsx";
import { renderApp } from "./render.jsx";
import { DOCTOR, http, ok, server } from "./server.js";

const PATIENT = { id: "p1", name: "Arjun Malhotra", email: "arjun@example.com", role: "patient", emailVerified: true };
const routes = [
  { path: "/patient/login", Component: PatientLogin },
  { path: "/intake/:token", Component: Intake },
  { path: "/patient", element: <Layout role="patient" />, children: [{ index: true, Component: PatientDashboard }] },
  { Component: Layout, children: [{ index: true, Component: Cases }] },
];
const signedInAs = (user) => server.use(http.post("*/api/v1/auth/refresh", () => ok({ user, accessToken: "tok" })));

const share = (over) => ({ id: "s1", status: "pending", requestedBy: "doctor", doctor: { name: "Dr Asha Menon", email: "asha@example.com" }, requestedAt: "2026-09-23T08:00:00Z", ...over });
function patientApi({ shares = [], sources = [] } = {}) {
  const calls = [];
  server.use(
    http.get("*/api/v1/me/record", () => ok({ id: "r1", name: PATIENT.name, documents: sources.length, linkedVisits: 1, activeShares: shares.filter((s) => s.status === "active").length, pendingRequests: 0 })),
    http.get("*/api/v1/me/record/sources", () => ok({ items: sources, total: sources.length, totalPages: 1 })),
    http.get("*/api/v1/me/shares", () => ok(shares)),
    http.post("*/api/v1/me/shares/:id/:action", ({ params }) => (calls.push(`${params.action} ${params.id}`), ok(null))),
    http.post("*/api/v1/me/record/sources", () => ok({ sources: [], received: 1, duplicates: ["old-report.pdf"] }, { status: 201 }))
  );
  return calls;
}

describe("patient accounts", () => {
  it("signing in on the patient page lands on the health record", async () => {
    patientApi();
    server.use(http.post("*/api/v1/auth/login", () => ok({ user: PATIENT, accessToken: "tok" })));
    const user = userEvent.setup();
    renderApp(routes, { at: "/patient/login" });
    expect(await screen.findByText("For patients")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), PATIENT.email);
    await user.type(screen.getByLabelText("Password"), "a-long-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Your health record", level: 1 })).toBeInTheDocument();
  });

  it("keeps patients out of the doctor area and doctors out of the patient area", async () => {
    signedInAs(PATIENT);
    patientApi();
    const first = renderApp(routes, { at: "/" });
    await waitFor(() => expect(first.router.state.location.pathname).toBe("/patient"));
    first.unmount();

    signedInAs(DOCTOR);
    server.use(http.get("*/api/v1/cases", () => ok({ items: [], total: 0, totalPages: 0 })));
    const second = renderApp(routes, { at: "/patient" });
    await waitFor(() => expect(second.router.state.location.pathname).toBe("/"));
  });
});

describe("patient dashboard", () => {
  it("approving a doctor's request goes through a clear consent step", async () => {
    signedInAs(PATIENT);
    const calls = patientApi({ shares: [share()], sources: [] });
    const user = userEvent.setup();
    renderApp(routes, { at: "/patient" });

    const requests = await screen.findByRole("region", { name: "A doctor asked to see your health record" });
    await user.click(within(requests).getByRole("button", { name: "Review and approve" }));
    const dialog = screen.getByRole("dialog", { name: "Share your health record with Dr Asha Menon?" });
    expect(dialog).toHaveTextContent("You can remove access at any time");
    await user.click(within(dialog).getByRole("button", { name: "Approve access" }));
    await waitFor(() => expect(calls).toEqual(["approve s1"]));
    expect(await screen.findByText("Dr Asha Menon can now see your health record")).toBeInTheDocument();
  });

  it("lists doctors with access, when they last looked, and removes access after confirming", async () => {
    signedInAs(PATIENT);
    const calls = patientApi({ shares: [share({ status: "active", respondedAt: "2026-09-20T08:00:00Z", lastAccessedAt: "2026-09-22T10:00:00Z" })] });
    const user = userEvent.setup();
    renderApp(routes, { at: "/patient" });

    const access = await screen.findByRole("region", { name: /Doctors with access/ });
    expect(access).toHaveTextContent(/last viewed/);
    await user.click(within(access).getByRole("button", { name: "Remove access" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove access" }));
    await waitFor(() => expect(calls).toEqual(["revoke s1"]));
  });

  it("shows where each document came from", async () => {
    signedInAs(PATIENT);
    patientApi({
      sources: [
        { id: "a", kind: "file", file: { name: "discharge.pdf" }, uploadedBy: "patient", processing: { status: "done" }, createdAt: "2026-09-01T00:00:00Z" },
        { id: "b", kind: "file", file: { name: "labs.pdf" }, uploadedBy: "doctor", fromVisit: { doctorName: "Dr Asha Menon" }, processing: { status: "processing" }, createdAt: "2026-09-02T00:00:00Z" },
      ],
    });
    renderApp(routes, { at: "/patient" });
    const docs = await screen.findByRole("region", { name: /Your documents/ });
    expect(await within(docs).findByRole("row", { name: /discharge.pdf/ })).toHaveTextContent("You");
    expect(within(docs).getByRole("row", { name: /labs.pdf/ })).toHaveTextContent("Visit with Dr Asha Menon");
    // the upload itself (and duplicate skipping) runs in the server tests and the patient e2e journey:
    // jsdom's FormData can't be sent by Node's fetch
  });
});

describe("doctor's link while signed in as a patient", () => {
  it("saves the visit to the record automatically and offers to share the full record", async () => {
    signedInAs(PATIENT);
    let shared = false;
    server.use(
      http.get("*/api/v1/intake/:token", () => ok({ expiresAt: "2026-09-30T00:00:00Z" })),
      http.post("*/api/v1/me/links", () => ok({ doctorName: "Dr Asha Menon", copied: 2, share: shared ? { id: "s1", status: "active" } : null })),
      http.post("*/api/v1/me/links/share", () => ((shared = true), ok({ id: "s1", status: "active" })))
    );
    const user = userEvent.setup();
    renderApp(routes, { at: "/intake/abcdefghijklmnopqrstuvwx" });
    expect(await screen.findByText(/Saved to your health record/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Share my health record with Dr Asha Menon" }));
    expect(await screen.findByText(/can see your full health record/)).toBeInTheDocument();
  });

  it("invites a signed-out visitor to keep the records, returning them to the link after sign-in", async () => {
    server.use(http.get("*/api/v1/intake/:token", () => ok({ expiresAt: "2026-09-30T00:00:00Z" })));
    renderApp(routes, { at: "/intake/abcdefghijklmnopqrstuvwx" });
    const signIn = await screen.findByRole("link", { name: "Sign in" });
    expect(signIn).toHaveAttribute("href", "/patient/login");
  });
});
