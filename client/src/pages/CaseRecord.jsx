import { useParams } from "react-router";
import RecordView from "../components/RecordView.jsx";

export default function CaseRecord() {
  const { caseId } = useParams();
  return (
    <RecordView
      apiBase={`/cases/${caseId}`}
      crumbs={(doc) => [
        { to: "/", label: "Cases" },
        { to: `/cases/${caseId}`, label: doc.case.patientName },
      ]}
    />
  );
}
