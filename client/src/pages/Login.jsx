import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { homeFor, useAuth } from "../auth.jsx";
import AuthShell from "../components/AuthShell.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";
import { InfoIcon } from "../components/Icons.jsx";
import { fieldProps } from "../lib/fieldProps.js";
import { safeInternalPath } from "../lib/safeRedirect.js";

const COPY = {
  doctor: { title: "Sign in", register: "/register", other: { to: "/patient/login", text: "Signing in as a patient?" } },
  patient: { title: "Sign in to your health record", register: "/patient/register", other: { to: "/login", text: "Are you a doctor?" } },
};

export default function Login({ audience = "doctor" }) {
  const { status, user, reason, login } = useAuth();
  const location = useLocation();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const copy = COPY[audience];

  // each account goes to its own home; a return-to page is honoured when it's same-origin
  if (status === "in") return <Navigate to={safeInternalPath(location.state?.from, homeFor(user))} replace />;

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
    <AuthShell
      audience={audience}
      title={copy.title}
      links={
        <>
          <p>
            <Link to="/forgot-password">Forgot your password?</Link>
          </p>
          <p>
            New to DocDoc?{" "}
            <Link to={copy.register} state={location.state}>
              Create an account
            </Link>
          </p>
          <p>
            {copy.other.text} <Link to={copy.other.to}>Sign in here</Link>
          </p>
        </>
      }
    >
      {reason === "expired" && (
        <div className="notice" role="status">
          <InfoIcon />
          <p>Your session has ended. Sign in again to continue where you left off.</p>
        </div>
      )}
      <form onSubmit={onSubmit}>
        <label className="field">
          <span className="label">Email</span>
          <input name="email" type="email" placeholder={audience === "patient" ? "you@example.com" : "you@hospital.org"} autoComplete="email" required {...fieldProps(error, "email", "login-error")} />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input name="password" type="password" autoComplete="current-password" required {...fieldProps(error, "password", "login-error")} />
        </label>
        {error && (
          <div className="form-actions">
            <ErrorMessage error={error} id="login-error" />
          </div>
        )}
        <button className="btn-primary" aria-busy={busy} disabled={busy}>
          Sign in
        </button>
      </form>
    </AuthShell>
  );
}
