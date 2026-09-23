// Patient questionnaires are already structured: they become facts directly, no AI involved.
// Each fact quotes the exact line of the rendered questionnaire, so citations work like documents.
const join = (...parts) => parts.filter(Boolean).join(" · ");

export function questionnaireToFacts(q) {
  const rows = [
    ...q.allergies.map((a) => ({
      category: "allergy",
      label: a.substance,
      details: join(a.reaction && `Reaction: ${a.reaction}`, a.severity !== "unknown" && `Severity: ${a.severity}`),
      line: `Allergy: ${join(a.substance, a.reaction, a.severity !== "unknown" && a.severity)}`,
    })),
    ...q.medications.map((m) => ({
      category: "medication",
      label: m.name,
      value: join(m.dose, m.frequency) || undefined,
      line: `Medication: ${join(m.name, m.dose, m.frequency)}`,
    })),
    ...q.conditions.map((c) => ({ category: "condition", label: c, line: `Condition: ${c}` })),
    ...q.surgeries.map((s) => ({ category: "procedure", label: s, line: `Surgery: ${s}` })),
    ...(q.familyHistory ? [{ category: "family_history", label: "Family history", value: q.familyHistory, line: `Family history: ${q.familyHistory}` }] : []),
    ...(q.other ? [{ category: "other", label: "Patient note", value: q.other, line: `Other: ${q.other}` }] : []),
  ];

  const text = rows.map((r) => r.line).join("\n");
  const facts = rows.map(({ line, ...fact }) => ({ ...fact, page: 1, quote: line }));
  return { pages: [{ page: 1, text, method: "entered" }], facts };
}
