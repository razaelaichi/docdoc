import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../lib/api.js";
import { fieldProps } from "../lib/fieldProps.js";
import { formatDate, formatDateTime } from "../lib/format.js";
import ErrorMessage from "./ErrorMessage.jsx";
import { RecordIcon } from "./Icons.jsx";
import { useToast } from "./Toaster.jsx";

const ENDED = {
  declined: "The patient declined your request.",
  revoked: "The patient removed your access.",
  cancelled: "You withdrew this request.",
};

// On a doctor's case: ask for the patient's own health record, and open it once they approve.
export default function RecordAccess({ caseId }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const access = useQuery({ queryKey: ["record-access", caseId], queryFn: ({ signal }) => api(`/cases/${caseId}/record-access`, { signal }) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["record-access", caseId] });
  const request = useMutation({
    mutationFn: (email) => api(`/cases/${caseId}/record-access`, { method: "POST", json: { email } }),
    onSuccess: () => (refresh(), toast("Request sent. You'll see here when the patient answers.")),
  });
  const withdraw = useMutation({
    mutationFn: () => api(`/cases/${caseId}/record-access`, { method: "DELETE" }),
    onSuccess: () => (refresh(), toast("Access withdrawn")),
  });

  const share = access.data?.share;
  const live = share && ["pending", "active"].includes(share.status);

  return (
    <section className="panel" aria-labelledby="phr-h">
      <div className="panel-head">
        <h2 id="phr-h">Patient's health record</h2>
      </div>
      <div className="panel-body">
        <ErrorMessage error={access.error} />
        {access.data?.linkedPatient && (
          <p className="body-text">
            <span className="pill pill-ok">Linked</span> The patient linked this case to their DocDoc account, so documents
            here are also saved in their own record.
          </p>
        )}

        {share?.status === "active" && (
          <>
            <p className="body-text">
              Shared by the patient on {formatDate(share.respondedAt)}. You see their complete history, including documents
              from other doctors, for as long as they allow.
            </p>
            <Link role="button" className="btn btn-primary" to={`/cases/${caseId}/shared-record`}>
              <RecordIcon />
              Open shared health record
            </Link>
          </>
        )}

        {share?.status === "pending" && (
          <p className="body-text">
            <span className="pill pill-flag">Waiting</span> Asked {share.patientEmail ? <strong>{share.patientEmail}</strong> : "the patient"} on{" "}
            {formatDateTime(share.requestedAt)}. Nothing is visible until the patient approves.
          </p>
        )}

        {live && (
          <button className="btn-sm" onClick={() => withdraw.mutate()} aria-busy={withdraw.isPending} disabled={withdraw.isPending}>
            {share.status === "active" ? "Give up access" : "Withdraw request"}
          </button>
        )}

        {!live && access.data && (
          <>
            {share && <p className="body-text">{ENDED[share.status]}</p>}
            <p className="body-text">
              If the patient keeps a DocDoc health record, ask for it here: once they approve, you see everything they've
              collected without anyone uploading it again.
            </p>
            <form className="inline-form" onSubmit={(e) => (e.preventDefault(), request.mutate(new FormData(e.currentTarget).get("email")))}>
              <input
                name="email"
                type="email"
                required
                aria-label="Patient's email"
                placeholder="Patient's email"
                autoComplete="off"
                {...fieldProps(request.error, "email", "request-error")}
              />
              <button className="btn-primary" aria-busy={request.isPending} disabled={request.isPending}>
                Request access
              </button>
            </form>
          </>
        )}
        <ErrorMessage error={request.error ?? withdraw.error} id="request-error" />
      </div>
    </section>
  );
}
