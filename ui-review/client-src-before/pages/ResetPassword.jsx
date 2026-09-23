import { useMutation } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api } from "../api.js";
import ErrorMessage from "../components/ErrorMessage.jsx";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const reset = useMutation({
    mutationFn: (password) =>
      api("/auth/reset-password", { method: "POST", json: { token: params.get("token"), password } }),
  });

  return (
    <main className="container" style={{ maxWidth: 480 }}>
      <h1>Choose a new password</h1>
      {reset.isSuccess ? (
        <p>
          Your password was changed and all other sessions were signed out. <Link to="/login">Sign in</Link>
        </p>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), reset.mutate(new FormData(e.currentTarget).get("password")))}>
          <input
            name="password"
            type="password"
            placeholder="New password (at least 12 characters)"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
          <ErrorMessage error={reset.error} />
          <button aria-busy={reset.isPending} disabled={reset.isPending}>
            Change password
          </button>
        </form>
      )}
    </main>
  );
}
