import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { api } from "../lib/api.js";
import { formatDate } from "../lib/format.js";
import { usePageTitle } from "../lib/usePageTitle.js";
import { BrandMark, CheckIcon, InfoIcon } from "../components/Icons.jsx";
import LinkToAccount from "../components/LinkToAccount.jsx";
import QuestionnaireForm from "../components/QuestionnaireForm.jsx";
import Spinner from "../components/Spinner.jsx";
import UploadForm from "../components/UploadForm.jsx";

// Public page the patient reaches from the link their doctor sent.
export default function Intake() {
  const { token } = useParams();
  const [sent, setSent] = useState(0);
  const link = useQuery({ queryKey: ["intake", token], queryFn: ({ signal }) => api(`/intake/${token}`, { signal }), retry: false });
  usePageTitle("Share your medical records");

  return (
    <>
      <header className="intake-bar">
        <div className="topbar-inner">
          <span className="brand">
            <BrandMark />
            DocDoc
          </span>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="page page-narrow">
        <div className="intake-head">
          <h1>Share your medical records</h1>
          {link.data && (
            <>
              <p>
                Upload earlier reports, prescriptions, scans or photos of documents, and tell your doctor anything they
                should know, such as allergies. You can add more until the link expires.
              </p>
              <p className="expiry">This link works until {formatDate(link.data.expiresAt)}.</p>
            </>
          )}
        </div>

        {link.isPending && <Spinner />}
        {link.error && (
          <div className="notice">
            <InfoIcon />
            <p>This link is invalid or has expired. Please ask your doctor for a new one.</p>
          </div>
        )}
        {link.data && (
          <>
            <LinkToAccount token={token} />
            <section className="panel intake-section">
              <div className="panel-head">
                <h2>Documents</h2>
              </div>
              <div className="panel-body">
                {sent > 0 && (
                  <div className="notice notice-ok" role="status">
                    <CheckIcon />
                    <p>
                      <strong>Thank you, we received {sent} item(s).</strong> You can upload more.
                    </p>
                  </div>
                )}
                <UploadForm
                  upload={(form) => api(`/intake/${token}/sources`, { method: "POST", form })}
                  onDone={(data) => setSent((n) => n + data.received)}
                  notePlaceholder="Anything that helps explain these documents"
                />
              </div>
            </section>
            <section className="panel intake-section">
              <div className="panel-head">
                <h2>Health questionnaire</h2>
              </div>
              <div className="panel-body">
                <QuestionnaireForm submit={(json) => api(`/intake/${token}/questionnaire`, { method: "POST", json })} />
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
