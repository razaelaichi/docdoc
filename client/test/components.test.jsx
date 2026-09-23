import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import ErrorMessage from "../src/components/ErrorMessage.jsx";
import Modal from "../src/components/Modal.jsx";
import QuestionnaireForm from "../src/components/QuestionnaireForm.jsx";
import { ToastProvider, useToast } from "../src/components/Toaster.jsx";
import UploadForm from "../src/components/UploadForm.jsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const withQuery = (ui) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

describe("Modal", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        {open && (
          <Modal title="Delete Arjun?" onClose={() => setOpen(false)}>
            <input aria-label="Confirm" />
          </Modal>
        )}
      </>
    );
  }

  it("is a labelled dialog and returns focus to its opener when closed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Delete Arjun?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });
});

describe("ErrorMessage", () => {
  it("announces the error, lists field issues and gives a reference for server faults", () => {
    render(<ErrorMessage id="e" error={{ message: "Could not save", status: 503, requestId: "abcdef12-3456", issues: [{ field: "body.name", message: "Required" }] }} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not save");
    expect(alert).toHaveTextContent("name: Required");
    expect(alert).toHaveTextContent("Reference abcdef12");
  });

  it("does not show a reference for the user's own input errors", () => {
    render(<ErrorMessage error={{ message: "Bad input", status: 400, requestId: "abcdef12-3456" }} />);
    expect(screen.getByRole("alert")).not.toHaveTextContent("Reference");
  });
});

describe("toasts", () => {
  function Trigger() {
    const toast = useToast();
    return <button onClick={() => toast("Link copied")}>Copy</button>;
  }

  it("announce through a polite status region and can be dismissed", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("status")).toHaveTextContent("Link copied");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    await user.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("QuestionnaireForm", () => {
  it("sends only filled rows and trimmed lines", async () => {
    const submit = vi.fn().mockResolvedValue(null);
    const user = userEvent.setup();
    render(withQuery(<QuestionnaireForm submit={submit} />));
    await user.type(screen.getByLabelText("Substance (e.g. penicillin)"), "Penicillin");
    await user.selectOptions(screen.getByLabelText("Severity"), "severe");
    await user.click(screen.getByRole("button", { name: /Add another medicine/ }));
    await user.type(screen.getByLabelText(/Long-term conditions/), "  Diabetes \n\n Hypertension ");
    await user.click(screen.getByRole("button", { name: "Send answers" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0]).toEqual({
      allergies: [{ substance: "Penicillin", reaction: "", severity: "severe" }],
      medications: [],
      conditions: ["Diabetes", "Hypertension"],
      surgeries: [],
      familyHistory: undefined,
      other: undefined,
    });
    expect(await screen.findByText("Thank you, your answers were received.")).toBeInTheDocument();
  });
});

describe("UploadForm", () => {
  it("lists chosen files and uploads them as multipart form data", async () => {
    const upload = vi.fn().mockResolvedValue({ received: 1, duplicates: [] });
    const user = userEvent.setup();
    render(withQuery(<UploadForm upload={upload} />));
    const file = new File(["%PDF-1.4"], "discharge.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Documents or images"), file);
    expect(screen.getByText("discharge.pdf")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(upload).toHaveBeenCalled());
    // jsdom's FormData can't read files set by user-event; the real multipart upload is covered in e2e
    expect(upload.mock.calls[0][0]).toBeInstanceOf(FormData);
    expect(upload.mock.calls[0][0].has("note")).toBe(true);
    await waitFor(() => expect(screen.queryByText("discharge.pdf")).not.toBeInTheDocument()); // form resets after success
  });
});
