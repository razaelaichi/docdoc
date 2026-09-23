import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { useAuth } from "../auth.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";

export default function Login() {
  const { status, login } = useAuth();
  const location = useLocation();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === "in") return <Navigate to={location.state?.from ?? "/"} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(Object.fromEntries(new FormData(e.currentTarget)));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container" style={{ maxWidth: 480 }}>
      <h1>Sign in to DocDoc</h1>
      <form onSubmit={onSubmit}>
        <input name="email" type="email" placeholder="Email" autoComplete="email" required />
        <input name="password" type="password" placeholder="Password" autoComplete="current-password" required />
        <ErrorMessage error={error} />
        <button aria-busy={busy} disabled={busy}>
          Sign in
        </button>
      </form>
      <p>
        <Link to="/forgot-password">Forgot your password?</Link>
        <br />
        New here? <Link to="/register">Create an account</Link>
      </p>
    </main>
  );
}
