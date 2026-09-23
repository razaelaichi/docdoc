export default function Spinner({ label = "Loading" }) {
  return (
    <p className="spinner" role="status">
      {label}
    </p>
  );
}
