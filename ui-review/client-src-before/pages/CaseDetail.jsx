import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api.js";
import ErrorMessage from "../components/ErrorMessage.jsx";
import QuestionnaireView from "../components/QuestionnaireView.jsx";
import UploadForm from "../components/UploadForm.jsx";
import { download } from "../download.js";


function UploadLinks({ caseId }) {
  const queryClient = useQueryClient();
  const [newUrl, setNewUrl] = useState(null); // shown once, never retrievable again
  const links = useQuery({ queryKey: ["links", caseId], queryFn: () => api(`/cases/${caseId}/upload-links`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["links", caseId] });

  const create = useMutation({
    mutationFn: () => api(`/cases/${caseId}/upload-links`, { method: "POST" }),
    onSuccess: (link) => (setNewUrl(link.url), refresh()),
  });
  const revoke = useMutation({
    mutationFn: (linkId) => api(`/cases/${caseId}/upload-links/${linkId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return (
    <section>
      <h3>Patient upload links</h3>
      {newUrl && (
        <article>
          <p>Send this link to the patient. It is shown only once.</p>
          <fieldset role="group">
            <input readOnly aria-label="Patient upload link" value={newUrl} onFocus={(e) => e.target.select()} />
            <button onClick={() => navigator.clipboard.writeText(newUrl)}>Copy</button>
          </fieldset>
        </article>
      )}
      <button className="outline" onClick={() => create.mutate()} aria-busy={create.isPending}>
        New upload link
      </button>
      <ErrorMessage error={create.error ?? revoke.error ?? links.error} />
      {links.data?.length > 0 && (
        <table>
          <tbody>
            {links.data.map((l) => (
              <tr key={l.id}>
                <td>Created {new Date(l.createdAt).toLocaleString()}</td>
                <td>{l.active ? `Expires ${new Date(l.expiresAt).toLocaleDateString()}` : "Inactive"}</td>
                <td>
                  {l.active && (
                    <button className="secondary outline" onClick={() => revoke.mutate(l.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ProcessingStatus({ caseId, source }) {
  const queryClient = useQueryClient();
  const reprocess = useMutation({
    mutationFn: () => api(`/cases/${caseId}/sources/${source.id}/reprocess`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources", caseId] }),
  });
  const p = source.processing;
  if (!p) return null;

  const notes = [
    p.uncoveredPages?.length > 0 && `no facts found on page ${p.uncoveredPages.join(", ")}`,
    p.lowConfidencePages?.length > 0 && `low OCR confidence on page ${p.lowConfidencePages.join(", ")}`,
  ].filter(Boolean);

  return (
    <>
      {p.status === "pending" && "Queued"}
      {p.status === "processing" && <span aria-busy="true">Processing</span>}
      {p.status === "done" && (p.aiStructured ? `${p.factCount} facts` : "Text extracted (AI not configured)")}
      {p.status === "failed" && <span style={{ color: "var(--pico-del-color)" }}>{p.error}</span>}
      {notes.length > 0 && <small style={{ display: "block" }}>⚠ {notes.join("; ")}</small>}
      {(p.status === "done" || p.status === "failed") && (
        <button className="outline secondary" style={{ padding: "0.2rem 0.5rem", marginLeft: "0.5rem" }} onClick={() => reprocess.mutate()}>
          Reprocess
        </button>
      )}
      <ErrorMessage error={reprocess.error} />
    </>
  );
}

function Sources({ caseId }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const sources = useQuery({
    queryKey: ["sources", caseId, page],
    queryFn: () => api(`/cases/${caseId}/sources?page=${page}&limit=50`),
    // poll only while the worker still has something from this page in hand
    refetchInterval: (query) =>
      query.state.data?.items.some((s) => ["pending", "processing"].includes(s.processing?.status)) ? 3000 : false,
  });
  const [downloadError, setDownloadError] = useState(null);

  return (
    <section>
      <h3>Sources {sources.data && `(${sources.data.total})`}</h3>
      <ErrorMessage error={sources.error ?? downloadError} />
      {sources.data?.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>From</th>
              <th>Content</th>
              <th>Added</th>
              <th>Processing</th>
            </tr>
          </thead>
          <tbody>
            {sources.data.items.map((s, i) => (
              <tr key={s.id}>
                <td>S{(page - 1) * 50 + i + 1}</td>
                <td>{s.uploadedBy}</td>
                <td>
                  {s.kind === "file" && (
                    <a href="#" onClick={(e) => (e.preventDefault(), download(`/cases/${caseId}/sources/${s.id}/file`, s.file.name).catch(setDownloadError))}>
                      {s.file.name}
                    </a>
                  )}
                  {s.kind === "note" && <span style={{ whiteSpace: "pre-wrap" }}>{s.note}</span>}
                  {s.kind === "questionnaire" && <QuestionnaireView q={s.questionnaire} />}
                </td>
                <td>{new Date(s.createdAt).toLocaleString()}</td>
                <td>
                  <ProcessingStatus caseId={caseId} source={s} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sources.data?.totalPages > 1 && (
        <div role="group">
          <button className="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button className="outline" disabled={page >= sources.data.totalPages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}

      <h4>Add documents</h4>
      <UploadForm
        upload={(form) => api(`/cases/${caseId}/sources`, { method: "POST", form })}
        onDone={() => queryClient.invalidateQueries({ queryKey: ["sources", caseId] })}
      />
    </section>
  );
}

function DeleteCase({ caseId, patientName }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api(`/cases/${caseId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["case", caseId] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      navigate("/");
    },
  });
  const confirmAndDelete = () => {
    // irreversible: the doctor must type the patient name
    if (window.prompt(`This permanently deletes all records of ${patientName}. Type the patient name to confirm.`) === patientName) {
      remove.mutate();
    }
  };
  return (
    <section>
      <h3>Delete case</h3>
      <p>Permanently removes every uploaded file, note, questionnaire and compiled result for this patient.</p>
      <button className="secondary" onClick={confirmAndDelete} aria-busy={remove.isPending}>
        Delete case permanently
      </button>
      <ErrorMessage error={remove.error} />
    </section>
  );
}

export default function CaseDetail() {
  const { caseId } = useParams();
  const found = useQuery({ queryKey: ["case", caseId], queryFn: () => api(`/cases/${caseId}`) });

  if (found.error) return <ErrorMessage error={found.error} />;
  if (!found.data) return <p aria-busy="true" />;
  return (
    <>
      <hgroup>
        <h2>{found.data.patientName}</h2>
        <p>Case opened {new Date(found.data.createdAt).toLocaleString()}</p>
      </hgroup>
      <Link role="button" to={`/cases/${caseId}/record`}>
        Open compiled record
      </Link>
      <UploadLinks caseId={caseId} />
      <Sources caseId={caseId} />
      <DeleteCase caseId={caseId} patientName={found.data.patientName} />
    </>
  );
}
