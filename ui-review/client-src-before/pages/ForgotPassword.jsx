import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../api.js";
import ErrorMessage from "../components/ErrorMessage.jsx";

export default function ForgotPassword() {
  const request = useMutation({
    mutationFn: (email) => api("/auth/forgot-password", { method: "POST", json: { email } }),
  });

  return (
    <main className="container" style={{ maxWidth: 480 }}>
      <h1>Reset your password</h1>
      {request.isSuccess ? (
        <p>If that email has an account, a reset link is on its way. It expires in one hour.</p>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), request.mutate(new FormData(e.currentTarget).get("email")))}>
          <input name="email" type="email" placeholder="Email" autoComplete="email" required />
          <ErrorMessage error={request.error} />
          <button aria-busy={request.isPending} disabled={request.isPending}>
            Send reset link
          </button>
        </form>
      )}
      <Link to="/login">Back to sign in</Link>
    </main>
  );
}
