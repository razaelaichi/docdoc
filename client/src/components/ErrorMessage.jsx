import { AlertIcon } from "./Icons.jsx";

// requestId is the support reference: it matches the API's log line for this failure.
export default function ErrorMessage({ error, id }) {
  if (!error) return null;
  return (
    <div role="alert" id={id} className="notice notice-alert">
      <AlertIcon />
      <div>
        <p>{error.message}</p>
        {error.issues?.map((i) => (
          <small key={i.field}>
            {i.field.split(".").pop()}: {i.message}
          </small>
        ))}
        {error.requestId && error.status >= 500 && <small className="ref-id">Reference {error.requestId.slice(0, 8)}</small>}
      </div>
    </div>
  );
}
