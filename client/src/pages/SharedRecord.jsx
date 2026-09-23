import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { InfoIcon } from "../components/Icons.jsx";
import RecordView from "../components/RecordView.jsx";
import { api } from "../lib/api.js";

// A patient's own health record, shared with this doctor for this case.
export default function SharedRecord() {
  const { caseId } = useParams();
  const found = useQuery({ queryKey: ["case", caseId], queryFn: ({ signal }) => api(`/cases/${caseId}`, { signal }) });
  return (
    <RecordView
      apiBase={`/cases/${caseId}/shared-record`}
      title="Shared health record"
      crumbs={() => [
        { to: "/", label: "Cases" },
        { to: `/cases/${caseId}`, label: found.data?.patientName ?? "Case" },
      ]}
      notice={
        <div className="notice">
          <InfoIcon />
          <p>
            The patient shared their complete health record with you. They can remove your access at any time, and
            they can see when you last opened it.
          </p>
        </div>
      }
    />
  );
}
