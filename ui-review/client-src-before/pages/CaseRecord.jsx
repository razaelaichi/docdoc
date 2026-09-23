import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api.js";
import AuthImage from "../components/AuthImage.jsx";
import CitationViewer from "../components/CitationViewer.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";
import { download } from "../download.js";

const ALERT = { color: "var(--pico-del-color)" };

function Fact({ fact, onCite, highlighted }) {
  return (
    <tr id={`fact-${fact.id}`} style={highlighted ? { outline: "2px solid var(--pico-del-color)" } : undefined}>
      <td>
        <strong>{fact.label}</strong>
        {fact.origin === "patient-reported" && <small> · patient-reported</small>}
        {fact.details && <small style={{ display: "block" }}>{fact.details}</small>}
        <small style={{ display: "block", fontStyle: "italic", color: "var(--pico-muted-color)" }}>“{fact.quote}”</small>
      </td>
      <td>
        {fact.value}
        {fact.flag && <small style={{ display: "block", ...ALERT }}>⚑ {fact.flag} printed range (analyser)</small>}
      </td>
      <td>{fact.date}</td>
      <td>
        <a href="#" onClick={(e) => (e.preventDefault(), onCite(fact.citation))}>
          [{fact.citation.ref} p.{fact.citation.page}]
        </a>
      </td>
    </tr>
  );
}

function FactTable({ facts, ...props }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Entry</th>
          <th>Value</th>
          <th>Date (as written)</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {facts.map((f) => (
          <Fact key={f.id} fact={f} highlighted={props.highlight.includes(f.id)} onCite={props.onCite} />
        ))}
      </tbody>
    </table>
  );
}

export default function CaseRecord() {
  const { caseId } = useParams();
  const [citation, setCitation] = useState(null);
  const [highlight, setHighlight] = useState([]);
  const record = useQuery({ queryKey: ["record", caseId], queryFn: () => api(`/cases/${caseId}/document`) });
  const exportFile = useMutation({
    mutationFn: ({ format, ext }) => download(`/cases/${caseId}/document/${format}`, `record-${caseId}.${ext}`),
  });

  if (record.error) return <ErrorMessage error={record.error} />;
  if (!record.data) return <p aria-busy="true">Compiling record…</p>;
  const doc = record.data;
  const sourceById = new Map(doc.sources.map((s) => [s.id, s]));
  const { pending, failed, notStructured } = doc.completeness;
  const cite = setCitation;
  const showConflict = (ids) => {
    setHighlight(ids);
    document.getElementById(`fact-${ids[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <>
      <hgroup>
        <h2>{doc.case.patientName}</h2>
        <p>
          Compiled record · {doc.sources.length} sources · generated {new Date(doc.generatedAt).toLocaleString()} ·{" "}
          <Link to={`/cases/${caseId}`}>back to case</Link>
        </p>
      </hgroup>
      <div role="group">
        <button onClick={() => exportFile.mutate({ format: "pdf", ext: "pdf" })} aria-busy={exportFile.isPending}>
          Download PDF
        </button>
        <button className="outline" onClick={() => exportFile.mutate({ format: "fhir", ext: "fhir.json" })}>
          Download FHIR (R4)
        </button>
      </div>
      <ErrorMessage error={exportFile.error} />
      <p>
        <small>
          Every entry is copied from its cited source and quoted verbatim; nothing is inferred. Items marked (analyser) are
          automatic cross-checks, not source data.
        </small>
      </p>

      {(pending.length > 0 || failed.length > 0 || notStructured.length > 0) && (
        <article style={ALERT}>
          {pending.length > 0 && <p>Still processing: {pending.join(", ")}</p>}
          {failed.length > 0 && <p>Could not be processed: {failed.join(", ")} (see source index)</p>}
          {notStructured.length > 0 && <p>Text extracted but not structured: {notStructured.join(", ")}</p>}
        </article>
      )}

      <section>
        <h3>⚠ Critical alerts</h3>
        {doc.alerts.allergies.length ? (
          <FactTable facts={doc.alerts.allergies} onCite={cite} highlight={highlight} />
        ) : (
          <p>No allergies recorded in any source.</p>
        )}
        {doc.alerts.conflicts.map((c, i) => (
          <p key={i} style={ALERT}>
            ⚑ {c.message} (analyser){" "}
            <a href="#" onClick={(e) => (e.preventDefault(), showConflict(c.factIds))}>
              show entries
            </a>
          </p>
        ))}
      </section>

      {doc.sections
        .filter((s) => s.key !== "allergy" && (s.facts.length || s.images?.length))
        .map((section) => (
          <section key={section.key}>
            <h3>{section.title}</h3>
            {section.key === "lab_result" ? (
              Object.entries(Object.groupBy(section.facts, (f) => f.label)).map(([label, facts]) => (
                <details key={label} open>
                  <summary>
                    {label} ({facts.length})
                  </summary>
                  <FactTable facts={facts} onCite={cite} highlight={highlight} />
                </details>
              ))
            ) : section.facts.length > 0 ? (
              <FactTable facts={section.facts} onCite={cite} highlight={highlight} />
            ) : null}
            {section.images?.map((img) => (
              <figure key={img.sourceId}>
                <AuthImage path={`/cases/${caseId}/sources/${img.sourceId}/file`} alt={img.name} />
                <figcaption>
                  {img.ref} · {img.name}
                  {img.citedBy.length === 0 && " · no findings extracted"}
                </figcaption>
              </figure>
            ))}
          </section>
        ))}

      <section>
        <h3>Source index</h3>
        <table>
          <tbody>
            {doc.sources.map((s) => (
              <tr key={s.id}>
                <td>{s.ref}</td>
                <td>{s.name}</td>
                <td>
                  {s.uploadedBy} · {new Date(s.uploadedAt).toLocaleDateString()}
                </td>
                <td>
                  {s.status}
                  {s.pages ? ` · ${s.pages} page(s)` : ""} · {s.factCount} facts
                  {s.uncoveredPages.length > 0 && <small style={{ display: "block" }}>no facts on page {s.uncoveredPages.join(", ")}</small>}
                  {s.error && <small style={{ display: "block", ...ALERT }}>{s.error}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {citation && (
        <CitationViewer
          caseId={caseId}
          citation={citation}
          sourceName={sourceById.get(citation.sourceId)?.name}
          onClose={() => setCitation(null)}
          onDownload={
            sourceById.get(citation.sourceId)?.kind === "file"
              ? () => download(`/cases/${caseId}/sources/${citation.sourceId}/file`, sourceById.get(citation.sourceId).name)
              : undefined
          }
        />
      )}
    </>
  );
}
