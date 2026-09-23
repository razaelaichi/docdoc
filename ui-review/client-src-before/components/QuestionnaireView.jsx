// Read-only rendering of a patient questionnaire in the doctor's source list
export default function QuestionnaireView({ q }) {
  const section = (title, items) =>
    items?.length > 0 && (
      <>
        <strong>{title}</strong>
        <ul>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </>
    );

  return (
    <details>
      <summary>Patient questionnaire</summary>
      {section(
        "Allergies",
        q.allergies.map((a) => [a.substance, a.reaction, a.severity !== "unknown" && a.severity].filter(Boolean).join(" · "))
      )}
      {section("Medicines", q.medications.map((m) => [m.name, m.dose, m.frequency].filter(Boolean).join(" · ")))}
      {section("Conditions", q.conditions)}
      {section("Surgeries", q.surgeries)}
      {section("Family history", q.familyHistory && [q.familyHistory])}
      {section("Other", q.other && [q.other])}
    </details>
  );
}
