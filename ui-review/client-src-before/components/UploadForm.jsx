import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import ErrorMessage from "./ErrorMessage.jsx";

// shared by the doctor's case page and the patient's upload page
export default function UploadForm({ upload, onDone }) {
  const formRef = useRef(null);
  const mutation = useMutation({
    mutationFn: upload,
    onSuccess: (data) => {
      formRef.current.reset();
      onDone?.(data);
    },
  });

  return (
    <form ref={formRef} onSubmit={(e) => (e.preventDefault(), mutation.mutate(new FormData(e.currentTarget)))}>
      <label>
        Documents or images (PDF, JPG, PNG, HEIC, TIFF, DICOM · up to 10 files, 15 MB each)
        <input type="file" name="files" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.tif,.tiff,.dcm" />
      </label>
      <label>
        Notes
        <textarea name="note" rows={3} maxLength={10000} placeholder="e.g. allergies, current medicines, anything else" />
      </label>
      <ErrorMessage error={mutation.error} />
      {mutation.data?.duplicates?.length > 0 && <p>Already uploaded, skipped: {mutation.data.duplicates.join(", ")}</p>}
      <button aria-busy={mutation.isPending} disabled={mutation.isPending}>
        Upload
      </button>
    </form>
  );
}
