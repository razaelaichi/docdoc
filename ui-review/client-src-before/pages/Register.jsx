import { useState } from "react";
import { Link, Navigate } from "react-router";
import { useAuth } from "../auth.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";

export default function Register() {
  const { status, register } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === "in") return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(Object.fromEntries(new FormData(e.currentTarget)));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container" style={{ maxWidth: 480 }}>
      <h1>Create a doctor account</h1>
      <form onSubmit={onSubmit}>
        <input name="name" placeholder="Full name" autoComplete="name" required maxLength={100} />
        <input name="email" type="email" placeholder="Email" autoComplete="email" required />
        <input
          name="password"
          type="password"
          placeholder="Password (at least 12 characters)"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
        <ErrorMessage error={error} />
        <button aria-busy={busy} disabled={busy}>
          Create account
        </button>
      </form>
      <p>
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </main>
  );
}
