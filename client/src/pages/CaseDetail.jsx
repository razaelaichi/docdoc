import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../lib/api.js";
import ErrorMessage from "../components/ErrorMessage.jsx";
import { CheckIcon, CopyIcon, FileIcon, ListIcon, NoteIcon, PlusIcon, RecordIcon } from "../components/Icons.jsx";
import Modal from "../components/Modal.jsx";
import QuestionnaireView from "../components/QuestionnaireView.jsx";
import RecordAccess from "../components/RecordAccess.jsx";
import Spinner from "../components/Spinner.jsx";
import { useToast } from "../components/Toaster.jsx";
import UploadForm from "../components/UploadForm.jsx";
import { download } from "../lib/download.js";
import { useFlag } from "../lib/flags.js";
import { formatDate, formatDateTime } from "../lib/format.js";
import { prefetchRecord } from "../lib/prefetch.js";
import { reportWorkflow } from "../lib/telemetry.js";
import { usePageTitle } from "../lib/usePageTitle.js";

// react-query callbacks that also record the workflow outcome
const workflow = (name, onSuccess) => ({
  onSuccess: (...args) => (reportWorkflow(name, "success"), onSuccess?.(...args)),
  onError: () => reportWorkflow(name, "failure"),
});

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast("Copying was blocked by the browser. Select the link and copy it manually.", { tone: "info" });
      return;
    }
    toast("Link copied");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="btn-primary" onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function UploadLinks({ caseId }) {
  const queryClient = useQueryClient();
  const [newUrl, setNewUrl] = useState(null); // shown once, never retrievable again
  const toast = useToast();
  const links = useQuery({ queryKey: ["links", caseId], queryFn: ({ signal }) => api(`/cases/${caseId}/upload-links`, { signal }) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["links", caseId] });

  const create = useMutation({
    mutationFn: () => api(`/cases/${caseId}/upload-links`, { method: "POST" }),
    ...workflow("create-upload-link", (link) => (setNewUrl(link.url), refresh())),
  });
  const revoke = useMutation({
    mutationFn: (linkId) => api(`/cases/${caseId}/upload-links/${linkId}`, { method: "DELETE" }),
    onSuccess: () => (refresh(), toast("Upload link revoked. It no longer works for the patient.")),
  });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Patient upload links</h2>
      </div>
      <div className="panel-body">
        <p className="body-text">
          The patient uses the link to upload documents and answer a short health questionnaire. They never see
          this case or anyone else’s records.
        </p>
        {newUrl && (
          <div className="link-reveal">
            <p>Send this link to the patient. It is shown only once.</p>
            <div className="inline-form">
              <input readOnly aria-label="Patient upload link" value={newUrl} onFocus={(e) => e.target.select()} />
              <CopyButton text={newUrl} />
            </div>
          </div>
        )}
        <button onClick={() => create.mutate()} aria-busy={create.isPending} disabled={create.isPending}>
          {!create.isPending && <PlusIcon />}
          New upload link
        </button>
        <ErrorMessage error={create.error ?? revoke.error ?? links.error} />
        {links.data?.length > 0 && (
          <ul className="link-list">
            {links.data.map((l) => (
              <li key={l.id}>
                <div>
                  {l.active ? <span className="pill pill-ok">Active</span> : <span className="pill">Inactive</span>}
                  <span className="when">
                    Created {formatDateTime(l.createdAt)}
                    {l.active && ` · expires ${formatDate(l.expiresAt)}`}
                  </span>
                </div>
                {l.active && (
                  <button className="btn-sm btn-danger" onClick={() => revoke.mutate(l.id)} disabled={revoke.isPending}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ProcessingStatus({ caseId, source }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const reprocess = useMutation({
    mutationFn: () => api(`/cases/${caseId}/sources/${source.id}/reprocess`, { method: "POST" }),
    onSuccess: () => (queryClient.invalidateQueries({ queryKey: ["sources", caseId] }), toast(`Reprocessing ${source.file?.name ?? "source"}`)),
  });
  const p = source.processing;
  if (!p) return <span className="muted">—</span>;

  const notes = [
    p.uncoveredPages?.length > 0 && `No facts found on page ${p.uncoveredPages.join(", ")}`,
    p.lowConfidencePages?.length > 0 && `Low OCR confidence on page ${p.lowConfidencePages.join(", ")}`,
  ].filter(Boolean);

  return (
    <div className="status-cell">
      <div className="status-line">
        {p.status === "pending" && <span className="pill">Queued</span>}
        {p.status === "processing" && <span className="pill pill-busy">Processing</span>}
        {p.status === "done" &&
          (p.aiStructured ? (
            <span className={p.factCount > 0 ? "pill pill-ok" : "pill"}>{p.factCount} facts</span>
          ) : (
            <span className="pill pill-flag">Text only · AI not configured</span>
          ))}
        {p.status === "failed" && <span className="pill pill-alert">Failed</span>}
        {(p.status === "done" || p.status === "failed") && (
          <button className="btn-ghost btn-sm" onClick={() => reprocess.mutate()} aria-busy={reprocess.isPending} disabled={reprocess.isPending}>
            Reprocess
          </button>
        )}
      </div>
      {p.status === "failed" && <small className="error">{p.error}</small>}
      {notes.map((n) => (
        <small key={n}>{n}</small>
      ))}
      <ErrorMessage error={reprocess.error} />
    </div>
  );
}

function SourceContent({ caseId, source, onDownloadError }) {
  if (source.kind === "file")
    return (
      <span className="source-name">
        <FileIcon />
        <a
          href="#"
          onClick={(e) => (e.preventDefault(), download(`/cases/${caseId}/sources/${source.id}/file`, source.file.name).catch(onDownloadError))}
        >
          {source.file.name}
        </a>
      </span>
    );
  if (source.kind === "note")
    return (
      <span className="source-name">
        <NoteIcon />
        <span className="note-text">{source.note}</span>
      </span>
    );
  return (
    <span className="source-name">
      <ListIcon />
      <QuestionnaireView q={source.questionnaire} />
    </span>
  );
}

// The AI pipeline finishes in the background; tell screen-reader users when a source is done
// instead of leaving them to notice a pill changing colour (WCAG 4.1.3).
function useProcessingAnnouncement(items) {
  const previous = useRef(new Map());
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!items) return;
    const finished = items.filter((s) => {
      const before = previous.current.get(s.id);
      return before && ["pending", "processing"].includes(before) && ["done", "failed"].includes(s.processing?.status);
    });
    previous.current = new Map(items.map((s) => [s.id, s.processing?.status]));
    if (finished.length) {
      const failed = finished.filter((s) => s.processing.status === "failed").length;
      setMessage(`${finished.length - failed} source(s) finished processing${failed ? `, ${failed} failed` : ""}.`);
    }
  }, [items]);
  return message;
}

function Sources({ caseId }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const sources = useQuery({
    queryKey: ["sources", caseId, page],
    queryFn: ({ signal }) => api(`/cases/${caseId}/sources?page=${page}&limit=50`, { signal }),
    // poll only while the worker still has something from this page in hand
    refetchInterval: (query) =>
      query.state.data?.items.some((s) => ["pending", "processing"].includes(s.processing?.status)) ? 3000 : false,
  });
  const [downloadError, setDownloadError] = useState(null);
  const announcement = useProcessingAnnouncement(sources.data?.items);
  const toast = useToast();

  return (
    <>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <section className="panel" aria-busy={sources.isFetching && !sources.isPending}>
        <div className="panel-head">
          <h2>
            Sources {sources.data && <span className="count">{sources.data.total}</span>}
          </h2>
        </div>
        {(sources.error ?? downloadError) && (
          <div className="panel-body">
            <ErrorMessage error={sources.error ?? downloadError} />
          </div>
        )}
        {sources.isPending && (
          <div className="empty">
            <Spinner />
          </div>
        )}
        {sources.data?.total === 0 && (
          <div className="empty">
            <strong>Nothing uploaded yet</strong>
            Add documents below, or send the patient an upload link.
          </div>
        )}
        {sources.data?.items.length > 0 && (
          <div className="table-wrap">
            <table className="table-min">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Source</th>
                  <th>From</th>
                  <th>Added</th>
                  <th>Processing</th>
                </tr>
              </thead>
              <tbody>
                {sources.data.items.map((s, i) => (
                  <tr key={s.id}>
                    <td className="ref">S{(page - 1) * 50 + i + 1}</td>
                    <td>
                      <SourceContent caseId={caseId} source={s} onDownloadError={setDownloadError} />
                    </td>
                    <td className="muted">{s.uploadedBy === "patient" ? "Patient" : "Doctor"}</td>
                    <td className="muted nowrap">{formatDateTime(s.createdAt)}</td>
                    <td>
                      <ProcessingStatus caseId={caseId} source={s} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sources.data?.totalPages > 1 && (
          <div className="panel-foot">
            <span>
              Page {page} of {sources.data.totalPages}
            </span>
            <div className="pager">
              <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button className="btn-sm" disabled={page >= sources.data.totalPages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Add documents</h2>
        </div>
        <div className="panel-body">
          <UploadForm
            upload={(form) => api(`/cases/${caseId}/sources`, { method: "POST", form })}
            onDone={(data) => {
              queryClient.invalidateQueries({ queryKey: ["sources", caseId] });
              toast(`${data.sources?.length ?? "Your"} item(s) added. Processing has started.`);
            }}
            notePlaceholder="A note for the record, e.g. history taken at the visit"
          />
        </div>
      </section>
    </>
  );
}

function DeleteCase({ caseId, patientName }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const remove = useMutation({
    mutationFn: () => api(`/cases/${caseId}`, { method: "DELETE" }),
    ...workflow("delete-case"),
    onSuccess: () => {
      reportWorkflow("delete-case", "success");
      toast(`${patientName} was deleted`);
      queryClient.removeQueries({ queryKey: ["case", caseId] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      navigate("/");
    },
  });
  const close = () => (setConfirming(false), setTyped(""));

  return (
    <section className="panel panel-danger">
      <div className="panel-head">
        <h2>Delete case</h2>
      </div>
      <div className="panel-body">
        <p className="body-text">Permanently removes every uploaded file, note, questionnaire and compiled result for this patient.</p>
        <button className="btn-danger" onClick={() => setConfirming(true)}>
          Delete case permanently
        </button>
      </div>
      {confirming && (
        <Modal
          size="sm"
          title={`Delete ${patientName}?`}
          onClose={close}
          footer={
            <>
              <button onClick={close}>Cancel</button>
              {/* irreversible: the doctor must type the patient name */}
              <button className="btn-danger-solid" disabled={typed !== patientName || remove.isPending} aria-busy={remove.isPending} onClick={() => remove.mutate()}>
                Delete permanently
              </button>
            </>
          }
        >
          <p className="body-text">
            This permanently deletes all records of <strong>{patientName}</strong>. It cannot be undone.
          </p>
          <label className="field">
            <span className="label">Type the patient name to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-autofocus />
          </label>
          <ErrorMessage error={remove.error} />
        </Modal>
      )}
    </section>
  );
}

export default function CaseDetail() {
  const { caseId } = useParams();
  const queryClient = useQueryClient();
  const prefetch = useFlag("intent-prefetch");
  const found = useQuery({ queryKey: ["case", caseId], queryFn: ({ signal }) => api(`/cases/${caseId}`, { signal }) });
  usePageTitle(found.data?.patientName);

  if (found.error) return <ErrorMessage error={found.error} />;
  if (!found.data) return <Spinner />;
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Cases</Link>
        <span className="sep">/</span>
        <span>{found.data.patientName}</span>
      </nav>
      <div className="page-head">
        <div>
          <h1 className="title">{found.data.patientName}</h1>
          <p className="meta">Case opened {formatDateTime(found.data.createdAt)}</p>
        </div>
        <div className="page-actions">
          <Link
            role="button"
            className="btn btn-primary"
            to={`/cases/${caseId}/record`}
            onMouseEnter={prefetch ? () => prefetchRecord(queryClient, caseId) : undefined}
            onFocus={prefetch ? () => prefetchRecord(queryClient, caseId) : undefined}
          >
            <RecordIcon />
            Open compiled record
          </Link>
        </div>
      </div>
      <div className="split">
        <div>
          <Sources caseId={caseId} />
        </div>
        <aside>
          <UploadLinks caseId={caseId} />
          <RecordAccess caseId={caseId} />
          <DeleteCase caseId={caseId} patientName={found.data.patientName} />
        </aside>
      </div>
    </>
  );
}
