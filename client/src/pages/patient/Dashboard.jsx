import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../../auth.jsx";
import ErrorMessage from "../../components/ErrorMessage.jsx";
import { FileIcon, InfoIcon, ListIcon, NoteIcon, RecordIcon, UploadIcon } from "../../components/Icons.jsx";
import Modal from "../../components/Modal.jsx";
import QuestionnaireForm from "../../components/QuestionnaireForm.jsx";
import Spinner from "../../components/Spinner.jsx";
import { useToast } from "../../components/Toaster.jsx";
import UploadForm from "../../components/UploadForm.jsx";
import { api } from "../../lib/api.js";
import { download } from "../../lib/download.js";
import { formatDate, formatDateTime, plural } from "../../lib/format.js";
import { usePageTitle } from "../../lib/usePageTitle.js";

const STATUS = {
  pending: ["pill-flag", "Waiting for you"],
  active: ["pill-ok", "Has access"],
  declined: ["", "Declined"],
  revoked: ["", "Access removed"],
  cancelled: ["", "Withdrawn by the doctor"],
};

function useShares() {
  return useQuery({ queryKey: ["me", "shares"], queryFn: ({ signal }) => api("/me/shares", { signal }) });
}

function useShareAction() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, action }) => api(`/me/shares/${id}/${action}`, { method: "POST" }),
    onSuccess: (_d, { action, doctor }) => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast(
        { approve: `${doctor} can now see your health record`, decline: `You declined ${doctor}'s request`, revoke: `${doctor} can no longer see your health record` }[action]
      );
    },
  });
}

// Approving is the important decision on this page: say exactly what the doctor will see.
function Requests({ shares, documents }) {
  const act = useShareAction();
  const [confirm, setConfirm] = useState(null);
  const pending = shares.filter((s) => s.status === "pending");
  if (!pending.length) return null;

  return (
    <section className="panel panel-request" aria-labelledby="requests-h">
      <div className="panel-head">
        <h2 id="requests-h">
          {pending.length === 1 ? "A doctor asked to see your health record" : `${pending.length} doctors asked to see your health record`}
        </h2>
      </div>
      <ul className="request-list">
        {pending.map((s) => (
          <li key={s.id}>
            <div>
              <strong>{s.doctor.name}</strong>
              {s.doctor.email && <span className="muted"> · {s.doctor.email}</span>}
              <span className="when">Asked {formatDateTime(s.requestedAt)}</span>
            </div>
            <div className="page-actions">
              <button className="btn-primary btn-sm" onClick={() => setConfirm(s)}>
                Review and approve
              </button>
              <button className="btn-sm" onClick={() => act.mutate({ id: s.id, action: "decline", doctor: s.doctor.name })} disabled={act.isPending}>
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
      <ErrorMessage error={act.error} />
      {confirm && (
        <Modal
          size="sm"
          title={`Share your health record with ${confirm.doctor.name}?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className="btn-primary"
                data-autofocus
                aria-busy={act.isPending}
                disabled={act.isPending}
                onClick={() => act.mutate({ id: confirm.id, action: "approve", doctor: confirm.doctor.name }, { onSuccess: () => setConfirm(null) })}
              >
                Approve access
              </button>
            </>
          }
        >
          <ul className="consent-list">
            <li>
              {confirm.doctor.name} will see your complete health record: {plural(documents, "document")} today, and anything
              you add later.
            </li>
            <li>You don't need to upload anything again.</li>
            <li>You can remove access at any time, and you'll see when they last looked.</li>
          </ul>
        </Modal>
      )}
    </section>
  );
}

function DoctorsWithAccess({ shares }) {
  const act = useShareAction();
  const [confirm, setConfirm] = useState(null);
  const active = shares.filter((s) => s.status === "active");
  const past = shares.filter((s) => !["active", "pending"].includes(s.status));

  return (
    <section className="panel" aria-labelledby="access-h">
      <div className="panel-head">
        <h2 id="access-h">
          Doctors with access <span className="count">{active.length}</span>
        </h2>
      </div>
      <div className="panel-body">
        {active.length === 0 ? (
          <p className="body-text">
            No one can see your record. When a new doctor asks, the request appears here for you to approve. You can also
            share it from a link your doctor sends you.
          </p>
        ) : (
          <ul className="link-list">
            {active.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{s.doctor.name}</strong>
                  <span className="when">
                    Since {formatDate(s.respondedAt)} · {s.lastAccessedAt ? `last viewed ${formatDateTime(s.lastAccessedAt)}` : "not viewed yet"}
                  </span>
                </div>
                <button className="btn-sm btn-danger" onClick={() => setConfirm(s)}>
                  Remove access
                </button>
              </li>
            ))}
          </ul>
        )}
        <ErrorMessage error={act.error} />
        {past.length > 0 && (
          <details className="q-view">
            <summary>History ({past.length})</summary>
            <ul className="link-list">
              {past.map((s) => (
                <li key={s.id}>
                  <div>
                    {s.doctor.name}
                    <span className="when">
                      {STATUS[s.status][1]} · {formatDate(s.endedAt ?? s.respondedAt ?? s.requestedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {confirm && (
        <Modal
          size="sm"
          title={`Remove ${confirm.doctor.name}'s access?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className="btn-danger-solid"
                data-autofocus
                aria-busy={act.isPending}
                disabled={act.isPending}
                onClick={() => act.mutate({ id: confirm.id, action: "revoke", doctor: confirm.doctor.name }, { onSuccess: () => setConfirm(null) })}
              >
                Remove access
              </button>
            </>
          }
        >
          <p className="body-text">
            {confirm.doctor.name} will immediately stop seeing your health record. Documents from your own visits with them
            stay in their case notes.
          </p>
        </Modal>
      )}
    </section>
  );
}

function Documents() {
  const [downloadError, setDownloadError] = useState(null);
  const sources = useQuery({
    queryKey: ["me", "sources"],
    queryFn: ({ signal }) => api("/me/record/sources?limit=100", { signal }),
    refetchInterval: (q) => (q.state.data?.items.some((s) => ["pending", "processing"].includes(s.processing?.status)) ? 3000 : false),
  });

  return (
    <section className="panel" aria-labelledby="docs-h">
      <div className="panel-head">
        <h2 id="docs-h">
          Your documents {sources.data && <span className="count">{sources.data.total}</span>}
        </h2>
      </div>
      <ErrorMessage error={sources.error ?? downloadError} />
      {sources.isPending && (
        <div className="empty">
          <Spinner />
        </div>
      )}
      {sources.data?.total === 0 && (
        <div className="empty">
          <strong>Your record is empty</strong>
          Add reports, prescriptions, scans or test results below, or open a link from your doctor.
        </div>
      )}
      {sources.data?.items.length > 0 && (
        <div className="table-wrap">
          <table className="table-min">
            <thead>
              <tr>
                <th>Document</th>
                <th>From</th>
                <th>Added</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sources.data.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="source-name">
                      {s.kind === "file" ? <FileIcon /> : s.kind === "note" ? <NoteIcon /> : <ListIcon />}
                      {s.kind === "file" ? (
                        <a
                          href="#"
                          onClick={(e) => (e.preventDefault(), download(`/me/record/sources/${s.id}/file`, s.file.name).catch(setDownloadError))}
                        >
                          {s.file.name}
                        </a>
                      ) : s.kind === "note" ? (
                        <span className="note-text">{s.note}</span>
                      ) : (
                        "Health questionnaire"
                      )}
                    </span>
                  </td>
                  <td className="muted">{s.fromVisit ? `Visit with ${s.fromVisit.doctorName}` : s.uploadedBy === "doctor" ? "Your doctor" : "You"}</td>
                  <td className="muted nowrap">{formatDateTime(s.createdAt)}</td>
                  <td>
                    {s.processing?.status === "done" ? (
                      <span className="pill pill-ok">Ready</span>
                    ) : s.processing?.status === "failed" ? (
                      <span className="pill pill-alert">Couldn't read</span>
                    ) : (
                      <span className="pill pill-busy">Reading</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Requests a doctor addresses to the patient's email only arrive once they've confirmed they own it.
function ConfirmEmail() {
  const { user } = useAuth();
  const toast = useToast();
  const resend = useMutation({
    mutationFn: () => api("/auth/verify-email/resend", { method: "POST" }),
    onSuccess: () => toast(`A new confirmation link is on its way to ${user.email}`),
  });
  if (user.emailVerified) return null;
  return (
    <div className="notice notice-flag confirm-email">
      <InfoIcon />
      <div>
        <p>
          <strong>Confirm your email address.</strong> Until you do, doctors who ask for your record by email can't reach
          you. We sent a link to {user.email}.
        </p>
        <button className="btn-link" onClick={() => resend.mutate()} disabled={resend.isPending}>
          Send the link again
        </button>
        <ErrorMessage error={resend.error} />
      </div>
    </div>
  );
}

export default function PatientDashboard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const record = useQuery({ queryKey: ["me", "record"], queryFn: ({ signal }) => api("/me/record", { signal }) });
  const shares = useShares();
  usePageTitle("Your health record");

  if (record.error) return <ErrorMessage error={record.error} />;
  if (!record.data) return <Spinner />;
  const r = record.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["me"] });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="title">Your health record</h1>
          <p className="meta">
            {plural(r.documents, "document")}
            {r.linkedVisits > 0 && ` · ${plural(r.linkedVisits, "linked visit")}`}
            {` · ${r.activeShares === 0 ? "private to you" : `shared with ${plural(r.activeShares, "doctor")}`}`}
          </p>
        </div>
        <div className="page-actions">
          <Link role="button" className="btn btn-primary" to="/patient/record">
            <RecordIcon />
            Open full record
          </Link>
        </div>
      </div>

      <ConfirmEmail />
      {shares.data && <Requests shares={shares.data} documents={r.documents} />}

      <div className="split">
        <div>
          <Documents />
          <section className="panel" aria-labelledby="add-h">
            <div className="panel-head">
              <h2 id="add-h">
                <UploadIcon />
                Add new documents
              </h2>
            </div>
            <div className="panel-body">
              <p className="body-text">
                Only add what's new: everything already in your record stays there, and a document you've added before is
                recognised and skipped.
              </p>
              <UploadForm
                upload={(form) => api("/me/record/sources", { method: "POST", form })}
                notePlaceholder="Anything that helps explain these documents"
                onDone={(data) => {
                  refresh();
                  toast(
                    data.duplicates.length
                      ? `${plural(data.received, "document")} added; ${data.duplicates.length} already in your record, skipped`
                      : `${plural(data.received, "document")} added to your record`
                  );
                }}
              />
            </div>
          </section>
          <section className="panel" aria-labelledby="q-h">
            <details className="q-section">
              <summary className="panel-head">
                <h2 id="q-h">Health questionnaire</h2>
              </summary>
              <div className="panel-body">
                <p className="body-text">Allergies, medicines and history in your own words. Every doctor you share with sees them.</p>
                <QuestionnaireForm submit={(json) => api("/me/record/questionnaire", { method: "POST", json }).then((d) => (refresh(), d))} />
              </div>
            </details>
          </section>
        </div>
        <aside>
          {shares.error && <ErrorMessage error={shares.error} />}
          {shares.data && <DoctorsWithAccess shares={shares.data} />}
        </aside>
      </div>
    </>
  );
}
