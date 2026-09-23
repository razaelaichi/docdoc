import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { api } from "../api.js";
import QuestionnaireForm from "../components/QuestionnaireForm.jsx";
import UploadForm from "../components/UploadForm.jsx";

// Public page the patient reaches from the link their doctor sent.
export default function Intake() {
  const { token } = useParams();
  const [sent, setSent] = useState(0);
  const link = useQuery({ queryKey: ["intake", token], queryFn: () => api(`/intake/${token}`), retry: false });

  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <h1>Share your medical records</h1>
      {link.isPending && <p aria-busy="true" />}
      {link.error && <p>This link is invalid or has expired. Please ask your doctor for a new one.</p>}
      {link.data && (
        <>
          <p>
            Upload previous reports, prescriptions, scans or photos of documents, and tell us anything your doctor
            should know, such as allergies. This link works until {new Date(link.data.expiresAt).toLocaleDateString()}.
          </p>
          {sent > 0 && (
            <p>
              <mark>Thank you, we received {sent} item(s).</mark> You can upload more.
            </p>
          )}
          <h2>Documents</h2>
          <UploadForm
            upload={(form) => api(`/intake/${token}/sources`, { method: "POST", form })}
            onDone={(data) => setSent((n) => n + data.received)}
          />
          <h2>Health questionnaire</h2>
          <QuestionnaireForm submit={(json) => api(`/intake/${token}/questionnaire`, { method: "POST", json })} />
        </>
      )}
    </main>
  );
}
