import RecordView from "../../components/RecordView.jsx";

// The patient's own compiled record: every document they hold, organised and cited.
export default function PatientRecord() {
  return <RecordView apiBase="/me/record" title="Full health record" crumbs={() => [{ to: "/patient", label: "Your health record" }]} />;
}
