export default function ErrorMessage({ error }) {
  if (!error) return null;
  return (
    <p role="alert" style={{ color: "var(--pico-del-color)" }}>
      {error.message}
      {error.issues?.map((i) => (
        <small key={i.field} style={{ display: "block" }}>
          {i.field.split(".").pop()}: {i.message}
        </small>
      ))}
    </p>
  );
}
