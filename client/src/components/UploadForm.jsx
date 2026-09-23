import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { reportWorkflow } from "../lib/telemetry.js";
import ErrorMessage from "./ErrorMessage.jsx";
import { FileIcon, UploadIcon } from "./Icons.jsx";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.tif,.tiff,.dcm";
const size = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// shared by the doctor's case page and the patient's upload page
export default function UploadForm({ upload, onDone, notePlaceholder = "e.g. allergies, current medicines, anything else" }) {
  const formRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [over, setOver] = useState(false);
  const mutation = useMutation({
    mutationFn: upload,
    onError: () => reportWorkflow("upload", "failure"),
    onSuccess: (data) => {
      reportWorkflow("upload", "success");
      formRef.current.reset();
      setFiles([]);
      onDone?.(data);
    },
  });

  return (
    <form ref={formRef} onSubmit={(e) => (e.preventDefault(), mutation.mutate(new FormData(e.currentTarget)))}>
      <label
        className={`dropzone${over ? " is-over" : ""}`}
        onDragEnter={() => setOver(true)}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
      >
        <UploadIcon />
        <strong>
          Drop files here or <span>browse</span>
        </strong>
        <small>PDF, JPG, PNG, HEIC, TIFF or DICOM · up to 10 files, 15 MB each</small>
        <input
          type="file"
          name="files"
          multiple
          accept={ACCEPT}
          aria-label="Documents or images"
          onChange={(e) => setFiles([...e.target.files])}
        />
      </label>
      {files.length > 0 && (
        <ul className="file-list" style={{ marginTop: 10 }}>
          {files.map((f) => (
            <li key={f.name}>
              <FileIcon />
              <span className="name">{f.name}</span>
              <span className="muted">{size(f.size)}</span>
            </li>
          ))}
        </ul>
      )}
      <label className="field" style={{ marginTop: 16 }}>
        <span className="label">
          Note <span className="hint">· optional</span>
        </span>
        <textarea name="note" rows={3} maxLength={10000} placeholder={notePlaceholder} />
      </label>
      {mutation.error && <div className="form-actions"><ErrorMessage error={mutation.error} /></div>}
      {mutation.data?.duplicates?.length > 0 && (
        <p className="body-text" style={{ marginTop: 12 }}>
          Already uploaded, skipped: {mutation.data.duplicates.join(", ")}
        </p>
      )}
      <div className="form-actions">
        <button className="btn-primary" aria-busy={mutation.isPending} disabled={mutation.isPending}>
          Upload
        </button>
      </div>
    </form>
  );
}
