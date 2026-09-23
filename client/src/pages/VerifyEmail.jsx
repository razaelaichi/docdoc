import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { homeFor, useAuth } from "../auth.jsx";
import AuthShell from "../components/AuthShell.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";
import { CheckIcon } from "../components/Icons.jsx";
import Spinner from "../components/Spinner.jsx";
import { api } from "../lib/api.js";

// The link from the confirmation email. The token is single-use and sent in the body, not logged.
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const { status, user, refreshUser } = useAuth();
  const verify = useMutation({
    mutationFn: (token) => api("/auth/verify-email", { method: "POST", json: { token } }),
    onSuccess: () => status === "in" && refreshUser().catch(() => {}),
  });
  const token = params.get("token");
  const { mutate } = verify;
  useEffect(() => {
    if (token) mutate(token);
  }, [token, mutate]);

  return (
    <AuthShell audience="patient" title="Confirm your email">
      {verify.isPending && <Spinner label="Confirming" />}
      {verify.isSuccess && (
        <div className="notice notice-ok" role="status">
          <CheckIcon />
          <p>
            Your email is confirmed. Doctors who ask for your record by email can now reach you.{" "}
            <Link to={status === "in" ? homeFor(user) : "/patient/login"}>{status === "in" ? "Continue" : "Sign in"}</Link>
          </p>
        </div>
      )}
      <ErrorMessage error={verify.error ?? (!token && { message: "This confirmation link is incomplete." })} />
    </AuthShell>
  );
}
