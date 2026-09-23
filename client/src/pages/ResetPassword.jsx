import { useMutation } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api } from "../lib/api.js";
import AuthShell from "../components/AuthShell.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";
import { fieldProps } from "../lib/fieldProps.js";
import { CheckIcon } from "../components/Icons.jsx";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const reset = useMutation({
    mutationFn: (password) =>
      api("/auth/reset-password", { method: "POST", json: { token: params.get("token"), password } }),
  });

  return (
    <AuthShell title="Choose a new password" lede={!reset.isSuccess && "Changing your password signs you out everywhere else."}>
      {reset.isSuccess ? (
        <div className="notice notice-ok" role="status">
          <CheckIcon />
          <p>
            Your password was changed and all other sessions were signed out. <Link to="/login">Sign in</Link>
          </p>
        </div>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), reset.mutate(new FormData(e.currentTarget).get("password")))}>
          <label className="field">
            <span className="label">
              New password <span className="hint">· at least 12 characters</span>
            </span>
            <input
              name="password"
              type="password"

              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              {...fieldProps(reset.error, "password", "reset-error")}
            />
          </label>
          {reset.error && <div className="form-actions"><ErrorMessage error={reset.error} id="reset-error" /></div>}
          <button className="btn-primary" aria-busy={reset.isPending} disabled={reset.isPending}>
            Change password
          </button>
        </form>
      )}
    </AuthShell>
  );
}
