import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api.js";
import AuthImage from "./AuthImage.jsx";
import CitationViewer from "./CitationViewer.jsx";
import ErrorMessage from "./ErrorMessage.jsx";
import { AlertIcon, DownloadIcon, FlagIcon, InfoIcon } from "./Icons.jsx";
import Spinner from "./Spinner.jsx";
import { download } from "../lib/download.js";
import { useFlag } from "../lib/flags.js";
import { formatDate, formatDateTime, plural } from "../lib/format.js";
import { reportWorkflow } from "../lib/telemetry.js";
import { usePageTitle } from "../lib/usePageTitle.js";

function Fact({ fact, onCite, highlighted, grouped }) {
  return (
    <tr id={`fact-${fact.id}`} className={highlighted ? "is-highlighted" : undefined}>
      <td>
        {/* inside a lab group the label is already the group's title */}
        {!grouped && <span className="fact-label">{fact.label}</span>}
        {fact.origin === "patient-reported" && (
          <>
            {" "}
            <span className="pill pill-plain">Patient-reported</span>
          </>
        )}
        {fact.details && <span className="fact-details">{fact.details}</span>}
        <span className="fact-quote">“{fact.quote}”</span>
      </td>
      <td>
        {fact.value}
        {fact.flag && (
          <span className="fact-flag">
            <FlagIcon />
            <span>{fact.flag} printed range (analyser)</span>
          </span>
        )}
      </td>
      <td className="date-cell">{fact.date || <span className="muted">—</span>}</td>
      <td>
        <a className="cite" href="#" onClick={(e) => (e.preventDefault(), onCite(fact.citation))}>
          [{fact.citation.ref} p.{fact.citation.page}]
        </a>
      </td>
    </tr>
  );
}

function FactTable({ facts, ...props }) {
  return (
    <div className="table-wrap">
      <table className="fact-table">
        <colgroup>
          <col className="c-entry" />
          <col />
          <col className="c-date" />
          <col className="c-source" />
        </colgroup>
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
            <Fact key={f.id} fact={f} highlighted={props.highlight.includes(f.id)} onCite={props.onCite} grouped={props.grouped} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const sectionCount = (s) => s.facts.length + (s.images?.length ?? 0);

// The compiled, cited record behind `apiBase`: a doctor's case (/cases/:id), a patient's own
// health record (/me/record) or a record a patient shared with a doctor (/cases/:id/shared-record).
export default function RecordView({ apiBase, crumbs, title = "Compiled record", notice }) {
  const [citation, setCitation] = useState(null);
  const [highlight, setHighlight] = useState([]);
  const record = useQuery({ queryKey: ["record", apiBase], queryFn: ({ signal }) => api(`${apiBase}/document`, { signal }) });
  const exportFile = useMutation({
    mutationFn: ({ format, ext }) => download(`${apiBase}/document/${format}`, `record-${record.data.case.id}.${ext}`),
    onSuccess: (_data, { format }) => reportWorkflow(`export-${format}`, "success"),
    onError: (_err, { format }) => reportWorkflow(`export-${format}`, "failure"),
  });
  const showContents = useFlag("record-contents");
  usePageTitle(record.data && title, record.data?.case.patientName);

  if (record.error) return <ErrorMessage error={record.error} />;
  if (!record.data) return <Spinner label="Compiling record" />;
  const doc = record.data;
  const sourceById = new Map(doc.sources.map((s) => [s.id, s]));
  const { pending, failed, notStructured } = doc.completeness;
  const cite = setCitation;
  const showConflict = (ids) => {
    setHighlight(ids);
    document.getElementById(`fact-${ids[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const sections = doc.sections.filter((s) => s.key !== "allergy" && sectionCount(s) > 0);
  const alertCount = doc.alerts.allergies.length + doc.alerts.conflicts.length;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs(doc).map(({ to, label }) => (
          <span key={to} className="crumb">
            <Link to={to}>{label}</Link>
            <span className="sep">/</span>
          </span>
        ))}
        <span>{title}</span>
      </nav>
      <div className="page-head">
        <div>
          <h1 className="title">{doc.case.patientName}</h1>
          <p className="meta">
            Compiled from {plural(doc.sources.length, "source")} · generated {formatDateTime(doc.generatedAt)}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => exportFile.mutate({ format: "pdf", ext: "pdf" })} aria-busy={exportFile.isPending && exportFile.variables?.format === "pdf"}>
            {!(exportFile.isPending && exportFile.variables?.format === "pdf") && <DownloadIcon />}
            Download PDF
          </button>
          <button onClick={() => exportFile.mutate({ format: "fhir", ext: "fhir.json" })} aria-busy={exportFile.isPending && exportFile.variables?.format === "fhir"}>
            Download FHIR (R4)
          </button>
        </div>
      </div>

      <div className={showContents ? "record-layout" : undefined}>
        {showContents && (
          <nav className="record-nav" aria-label="Record sections">
            <p>Contents</p>
            <ul>
              <li>
                <a href="#alerts" className={alertCount ? "is-alert" : undefined}>
                  Critical alerts <span className="n">{alertCount}</span>
                </a>
              </li>
              {sections.map((s) => (
                <li key={s.key}>
                  <a href={`#section-${s.key}`}>
                    {s.title} <span className="n">{sectionCount(s)}</span>
                  </a>
                </li>
              ))}
              <li>
                <a href="#sources">
                  Source index <span className="n">{doc.sources.length}</span>
                </a>
              </li>
            </ul>
          </nav>
        )}

        <div className="record-body">
          <p className="provenance">
            <InfoIcon />
            <span>
              Every entry is copied from its cited source and quoted verbatim; nothing is inferred. Items marked
              (analyser) are automatic cross-checks, not source data.
            </span>
          </p>
          {notice}
          <ErrorMessage error={exportFile.error} />

          {(pending.length > 0 || failed.length > 0 || notStructured.length > 0) && (
            <div className="notice notice-flag">
              <FlagIcon />
              <div>
                <p>
                  <strong>This record may be incomplete.</strong>
                </p>
                {pending.length > 0 && <p>Still processing: {pending.join(", ")}</p>}
                {failed.length > 0 && <p>Could not be processed: {failed.join(", ")} (see source index)</p>}
                {notStructured.length > 0 && <p>Text extracted but not structured: {notStructured.join(", ")}</p>}
              </div>
            </div>
          )}

          <section id="alerts" className="panel panel-alert" aria-labelledby="h-alerts">
            <div className="panel-head">
              <h2 id="h-alerts">
                <AlertIcon />
                Critical alerts
              </h2>
            </div>
            {doc.alerts.allergies.length ? (
              <FactTable facts={doc.alerts.allergies} onCite={cite} highlight={highlight} />
            ) : (
              <p className="panel-body body-text">No allergies recorded in any source.</p>
            )}
            {doc.alerts.conflicts.length > 0 && (
              <div className="conflicts">
                {doc.alerts.conflicts.map((c, i) => (
                  <div key={i} className="notice notice-flag">
                    <FlagIcon />
                    <div>
                      <p>
                        <span>{c.message} (analyser)</span>{" "}
                        <button className="btn-link" onClick={() => showConflict(c.factIds)}>
                          Show entries
                        </button>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {sections.map((section) => (
            <section key={section.key} id={`section-${section.key}`} className="panel record-section" aria-labelledby={`h-${section.key}`}>
              <div className="panel-head">
                <h2 id={`h-${section.key}`}>
                  {section.title} <span className="count">{sectionCount(section)}</span>
                </h2>
              </div>
              {section.key === "lab_result"
                ? Object.entries(Object.groupBy(section.facts, (f) => f.label)).map(([label, facts]) => (
                    <details key={label} className="lab-group" open>
                      <summary>
                        {label} <span className="n">{facts.length}</span>
                      </summary>
                      <FactTable facts={facts} onCite={cite} highlight={highlight} grouped />
                    </details>
                  ))
                : section.facts.length > 0 && <FactTable facts={section.facts} onCite={cite} highlight={highlight} />}
              {section.images?.length > 0 && (
                <div className="image-grid">
                  {section.images.map((img) => (
                    <figure key={img.sourceId}>
                      <AuthImage path={`${apiBase}/sources/${img.sourceId}/file`} alt={img.name} />
                      <figcaption>
                        <span className="ref">{img.ref}</span> · {img.name}
                        {img.citedBy.length === 0 && <span className="muted"> · no findings extracted</span>}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </section>
          ))}

          <section id="sources" className="panel record-section" aria-labelledby="h-sources">
            <div className="panel-head">
              <h2 id="h-sources">
                Source index <span className="count">{doc.sources.length}</span>
              </h2>
            </div>
            <div className="table-wrap">
              <table className="table-min">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Source</th>
                    <th>From</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.sources.map((s) => (
                    <tr key={s.id}>
                      <td className="ref">{s.ref}</td>
                      <td style={{ overflowWrap: "anywhere" }}>{s.name}</td>
                      <td className="muted nowrap">
                        {s.uploadedBy === "patient" ? "Patient" : "Doctor"} · {formatDate(s.uploadedAt)}
                      </td>
                      <td>
                        <span className="nowrap">
                          {s.status}
                          {s.pages ? ` · ${plural(s.pages, "page")}` : ""} · {plural(s.factCount, "entry", "entries")}
                        </span>
                        {s.uncoveredPages.length > 0 && <small className="fact-details">No entries on page {s.uncoveredPages.join(", ")}</small>}
                        {s.error && <small className="fact-details" style={{ color: "var(--alert)" }}>{s.error}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {citation && (
        <CitationViewer
          apiBase={apiBase}
          citation={citation}
          sourceName={sourceById.get(citation.sourceId)?.name}
          onClose={() => setCitation(null)}
          onDownload={
            sourceById.get(citation.sourceId)?.kind === "file"
              ? () => download(`${apiBase}/sources/${citation.sourceId}/file`, sourceById.get(citation.sourceId).name)
              : undefined
          }
        />
      )}
    </>
  );
}
