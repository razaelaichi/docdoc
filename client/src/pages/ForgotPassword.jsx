import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../lib/api.js";
import AuthShell from "../components/AuthShell.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";
import { fieldProps } from "../lib/fieldProps.js";
import { CheckIcon } from "../components/Icons.jsx";

export default function ForgotPassword() {
  const request = useMutation({
    mutationFn: (email) => api("/auth/forgot-password", { method: "POST", json: { email } }),
  });

  return (
    <AuthShell
      title="Reset your password"
      lede={!request.isSuccess && "Enter the email you signed up with and we will send you a reset link."}
      links={
        <p>
          <Link to="/login">Back to sign in</Link>
        </p>
      }
    >
      {request.isSuccess ? (
        <div className="notice notice-ok" role="status">
          <CheckIcon />
          <p>If that email has an account, a reset link is on its way. It expires in one hour.</p>
        </div>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), request.mutate(new FormData(e.currentTarget).get("email")))}>
          <label className="field">
            <span className="label">Email</span>
            <input name="email" type="email" placeholder="you@hospital.org" autoComplete="email" required {...fieldProps(request.error, "email", "forgot-error")} />
          </label>
          {request.error && <div className="form-actions"><ErrorMessage error={request.error} id="forgot-error" /></div>}
          <button className="btn-primary" aria-busy={request.isPending} disabled={request.isPending}>
            Send reset link
          </button>
        </form>
      )}
    </AuthShell>
  );
}
