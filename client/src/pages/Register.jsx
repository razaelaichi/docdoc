import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { homeFor, useAuth } from "../auth.jsx";
import AuthShell from "../components/AuthShell.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";
import { fieldProps } from "../lib/fieldProps.js";
import { safeInternalPath } from "../lib/safeRedirect.js";

const COPY = {
  doctor: { title: "Create a doctor account", lede: "Collect a patient's records from any hospital into one cited record.", signIn: "/login" },
  patient: {
    title: "Create your health record",
    lede: "Keep your reports, prescriptions, scans and test results in one place, and share them with a doctor when you choose.",
    signIn: "/patient/login",
  },
};

export default function Register({ audience = "doctor" }) {
  const { status, user, register } = useAuth();
  const location = useLocation();
  const copy = COPY[audience];
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === "in") return <Navigate to={safeInternalPath(location.state?.from, homeFor(user))} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({ ...Object.fromEntries(new FormData(e.currentTarget)), accountType: audience });
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
      lede={copy.lede}
      links={
        <p>
          Already registered?{" "}
          <Link to={copy.signIn} state={location.state}>
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit}>
        <label className="field">
          <span className="label">Name</span>
          <input name="name" autoComplete="name" required maxLength={100} {...fieldProps(error, "name", "register-error")} />
        </label>
        <label className="field">
          <span className="label">Email</span>
          <input name="email" type="email" autoComplete="email" required {...fieldProps(error, "email", "register-error")} />
        </label>
        <label className="field">
          <span className="label">
            Password <span className="hint">· at least 12 characters</span>
          </span>
          <input
            name="password"
            type="password"

            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            {...fieldProps(error, "password", "register-error")}
          />
        </label>
        {error && <div className="form-actions"><ErrorMessage error={error} id="register-error" /></div>}
        <button className="btn-primary" aria-busy={busy} disabled={busy}>
          Create account
        </button>
      </form>
    </AuthShell>
  );
}
