import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { useAuth } from "../auth.jsx";
import { api } from "../lib/api.js";
import ErrorMessage from "./ErrorMessage.jsx";
import { CheckIcon, InfoIcon } from "./Icons.jsx";
import { useToast } from "./Toaster.jsx";

// On a doctor's upload link: a signed-in patient has the visit saved into their health record
// automatically, and can share their full record with this doctor in one step.
export default function LinkToAccount({ token }) {
  const { status, user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const isPatient = status === "in" && user.role === "patient";
  // idempotent on the server, so it's safe as a (cached) query: StrictMode or a reload won't duplicate anything
  const claim = useQuery({
    queryKey: ["link-claim", token],
    queryFn: () => api("/me/links", { method: "POST", json: { token } }),
    enabled: isPatient,
    staleTime: Infinity,
    retry: false,
  });
  const share = useMutation({
    mutationFn: () => api("/me/links/share", { method: "POST", json: { token } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["link-claim", token] });
      toast(`${claim.data.doctorName} can now see your health record`);
    },
  });

  if (status === "loading" || (status === "in" && !isPatient)) return null;

  if (status === "out")
    return (
      <div className="notice account-offer">
        <InfoIcon />
        <p>
          <strong>Keep these records.</strong> With a DocDoc health record, everything from this visit is saved for you, and
          you never upload the same document twice.{" "}
          <Link to="/patient/login" state={{ from: `/intake/${token}` }}>
            Sign in
          </Link>{" "}
          or{" "}
          <Link to="/patient/register" state={{ from: `/intake/${token}` }}>
            create one
          </Link>
          .
        </p>
      </div>
    );

  if (claim.error) return <ErrorMessage error={claim.error} />;
  if (!claim.data) return null;
  const { doctorName, share: current } = claim.data;

  return (
    <section className="panel link-account" aria-labelledby="link-h">
      <div className="panel-body">
        <div className="notice notice-ok" role="status">
          <CheckIcon />
          <p id="link-h">
            <strong>Saved to your health record.</strong> This visit with {doctorName} is linked to your account: its documents,
            and anything added later, appear in your record automatically. <Link to="/patient">Open your record</Link>
          </p>
        </div>
        {current?.status === "active" ? (
          <p className="body-text">{doctorName} can see your full health record. You can remove access from your record page.</p>
        ) : (
          <div className="share-offer">
            <p className="body-text">
              {current?.status === "pending" ? `${doctorName} asked to see your full health record. ` : ""}
              Share your full health record with {doctorName}, and you only need to upload documents that are new since
              your last visit. You can remove access at any time.
            </p>
            <button className="btn-primary" onClick={() => share.mutate()} aria-busy={share.isPending} disabled={share.isPending}>
              Share my health record with {doctorName}
            </button>
            <ErrorMessage error={share.error} />
          </div>
        )}
      </div>
    </section>
  );
}
