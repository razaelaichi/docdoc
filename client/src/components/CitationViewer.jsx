import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "../lib/api.js";
import ErrorMessage from "./ErrorMessage.jsx";
import { DownloadIcon } from "./Icons.jsx";
import Modal from "./Modal.jsx";
import Spinner from "./Spinner.jsx";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Shows the quoted span inside the full page text, whitespace-tolerant like the server's check.
function Highlighted({ text, quote }) {
  const markRef = useRef(null);
  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center" });
  }, []);

  const pattern = new RegExp(quote.trim().split(/\s+/).map(escape).join("\\s+"), "i");
  const match = text.match(pattern);
  if (!match) return <pre className="source-text">{text}</pre>;
  const at = match.index;
  return (
    <pre className="source-text">
      {text.slice(0, at)}
      <mark ref={markRef}>{match[0]}</mark>
      {text.slice(at + match[0].length)}
    </pre>
  );
}

export default function CitationViewer({ apiBase, citation, sourceName, onClose, onDownload }) {
  const text = useQuery({
    queryKey: ["source-text", apiBase, citation.sourceId],
    queryFn: ({ signal }) => api(`${apiBase}/sources/${citation.sourceId}/text`, { signal }),
  });
  const page = text.data?.pages.find((p) => p.page === citation.page);

  return (
    <Modal
      title={sourceName ?? "Source"}
      onClose={onClose}
      meta={
        <>
          <span className="cite">{citation.ref}</span>
          <span>Page {citation.page}</span>
          {page?.method === "ocr" && <span>· Read by OCR, {page.confidence}% confidence</span>}
        </>
      }
      footer={
        onDownload && (
          <button onClick={onDownload}>
            <DownloadIcon />
            Download original
          </button>
        )
      }
    >
      <ErrorMessage error={text.error} />
      {text.isPending && <Spinner label="Loading page text" />}
      {page && <Highlighted text={page.text} quote={citation.quote} />}
    </Modal>
  );
}
