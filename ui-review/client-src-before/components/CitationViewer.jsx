import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import ErrorMessage from "./ErrorMessage.jsx";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Shows the quoted span inside the full page text, whitespace-tolerant like the server's check.
function Highlighted({ text, quote }) {
  const pattern = new RegExp(quote.trim().split(/\s+/).map(escape).join("\\s+"), "i");
  const match = text.match(pattern);
  if (!match) return <pre style={{ whiteSpace: "pre-wrap" }}>{text}</pre>;
  const at = match.index;
  return (
    <pre style={{ whiteSpace: "pre-wrap" }}>
      {text.slice(0, at)}
      <mark>{match[0]}</mark>
      {text.slice(at + match[0].length)}
    </pre>
  );
}

export default function CitationViewer({ caseId, citation, sourceName, onClose, onDownload }) {
  const text = useQuery({
    queryKey: ["source-text", citation.sourceId],
    queryFn: () => api(`/cases/${caseId}/sources/${citation.sourceId}/text`),
  });
  const page = text.data?.pages.find((p) => p.page === citation.page);

  return (
    <dialog open onClose={onClose}>
      <article style={{ maxWidth: 900 }}>
        <header>
          <button aria-label="Close" rel="prev" onClick={onClose} />
          <strong>
            {citation.ref} · {sourceName} · page {citation.page}
          </strong>
          {page?.method === "ocr" && <small> · OCR confidence {page.confidence}%</small>}
        </header>
        <ErrorMessage error={text.error} />
        {text.isPending && <p aria-busy="true" />}
        {page && <Highlighted text={page.text} quote={citation.quote} />}
        {onDownload && (
          <footer>
            <button className="outline" onClick={onDownload}>
              Download original
            </button>
          </footer>
        )}
      </article>
    </dialog>
  );
}
