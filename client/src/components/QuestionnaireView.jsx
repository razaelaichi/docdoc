// Read-only rendering of a patient questionnaire in the doctor's source list
export default function QuestionnaireView({ q }) {
  const rows = [
    ["Allergies", q.allergies.map((a) => [a.substance, a.reaction, a.severity !== "unknown" && a.severity].filter(Boolean).join(" · "))],
    ["Medicines", q.medications.map((m) => [m.name, m.dose, m.frequency].filter(Boolean).join(" · "))],
    ["Conditions", q.conditions],
    ["Surgeries", q.surgeries],
    ["Family history", q.familyHistory && [q.familyHistory]],
    ["Other", q.other && [q.other]],
  ].filter(([, items]) => items?.length > 0);

  return (
    <details className="q-view">
      <summary>Patient questionnaire</summary>
      {rows.length === 0 ? (
        <p className="muted" style={{ marginTop: 8 }}>
          Submitted with no answers.
        </p>
      ) : (
        <dl>
          {rows.map(([title, items]) => (
            <div key={title} style={{ display: "contents" }}>
              <dt>{title}</dt>
              <dd>
                {items.length === 1 ? (
                  items[0]
                ) : (
                  <ul>
                    {items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </details>
  );
}
