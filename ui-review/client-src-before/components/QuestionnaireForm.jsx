import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import ErrorMessage from "./ErrorMessage.jsx";

const lines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);
const filled = (rows, key) => rows.filter((r) => r[key].trim());

// Repeating rows of inputs, e.g. one row per allergy
function Rows({ legend, rows, setRows, fields, empty }) {
  const update = (i, key, value) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  return (
    <fieldset>
      <legend>{legend}</legend>
      {rows.map((row, i) => (
        <div role="group" key={i}>
          {fields.map(({ key, label, options }) =>
            options ? (
              <select key={key} aria-label={label} value={row[key]} onChange={(e) => update(i, key, e.target.value)}>
                {options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input key={key} placeholder={label} maxLength={200} value={row[key]} onChange={(e) => update(i, key, e.target.value)} />
            )
          )}
        </div>
      ))}
      <button type="button" className="outline secondary" onClick={() => setRows([...rows, { ...empty }])}>
        Add another
      </button>
    </fieldset>
  );
}

const EMPTY_ALLERGY = { substance: "", reaction: "", severity: "unknown" };
const EMPTY_MEDICATION = { name: "", dose: "", frequency: "" };

export default function QuestionnaireForm({ submit }) {
  const [allergies, setAllergies] = useState([EMPTY_ALLERGY]);
  const [medications, setMedications] = useState([EMPTY_MEDICATION]);
  const mutation = useMutation({ mutationFn: submit });

  if (mutation.isSuccess) return <p><mark>Thank you, your answers were received.</mark></p>;

  function onSubmit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    mutation.mutate({
      allergies: filled(allergies, "substance"),
      medications: filled(medications, "name"),
      conditions: lines(form.get("conditions")),
      surgeries: lines(form.get("surgeries")),
      familyHistory: form.get("familyHistory").trim() || undefined,
      other: form.get("other").trim() || undefined,
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <Rows
        legend="Allergies"
        rows={allergies}
        setRows={setAllergies}
        empty={EMPTY_ALLERGY}
        fields={[
          { key: "substance", label: "Substance (e.g. penicillin)" },
          { key: "reaction", label: "Reaction (e.g. rash)" },
          { key: "severity", label: "Severity", options: ["unknown", "mild", "moderate", "severe"] },
        ]}
      />
      <Rows
        legend="Current medicines"
        rows={medications}
        setRows={setMedications}
        empty={EMPTY_MEDICATION}
        fields={[
          { key: "name", label: "Medicine" },
          { key: "dose", label: "Dose (e.g. 500 mg)" },
          { key: "frequency", label: "How often" },
        ]}
      />
      <label>
        Long-term conditions <small>(one per line)</small>
        <textarea name="conditions" rows={3} />
      </label>
      <label>
        Past surgeries or procedures <small>(one per line, with year if known)</small>
        <textarea name="surgeries" rows={3} />
      </label>
      <label>
        Family history
        <textarea name="familyHistory" rows={2} maxLength={5000} />
      </label>
      <label>
        Anything else your doctor should know
        <textarea name="other" rows={3} maxLength={5000} />
      </label>
      <ErrorMessage error={mutation.error} />
      <button aria-busy={mutation.isPending} disabled={mutation.isPending}>
        Send answers
      </button>
    </form>
  );
}
