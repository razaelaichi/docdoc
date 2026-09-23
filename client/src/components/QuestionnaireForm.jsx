import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { reportWorkflow } from "../lib/telemetry.js";
import ErrorMessage from "./ErrorMessage.jsx";
import { CheckIcon, CloseIcon, PlusIcon } from "./Icons.jsx";

const lines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);
const filled = (rows, key) => rows.filter((r) => r[key].trim());

// Repeating rows of inputs, e.g. one row per allergy
function Rows({ legend, hint, rows, setRows, fields, empty, addLabel }) {
  const update = (i, key, value) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const remove = (i) => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ ...empty }]);
  return (
    <fieldset className="q-group">
      <legend>{legend}</legend>
      <p className="hint">{hint}</p>
      {rows.map((row, i) => (
        <div className="row-fields" key={i}>
          {fields.map(({ key, label, options }) =>
            options ? (
              <select key={key} aria-label={label} value={row[key]} onChange={(e) => update(i, key, e.target.value)}>
                {options.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            ) : (
              <input
                key={key}
                aria-label={label}
                placeholder={label}
                maxLength={200}
                value={row[key]}
                onChange={(e) => update(i, key, e.target.value)}
              />
            )
          )}
          <button type="button" className="btn-ghost btn-icon" aria-label={`Remove ${legend.toLowerCase()} row ${i + 1}`} onClick={() => remove(i)}>
            <CloseIcon />
          </button>
        </div>
      ))}
      <button type="button" className="btn-sm add-row" onClick={() => setRows([...rows, { ...empty }])}>
        <PlusIcon />
        {addLabel}
      </button>
    </fieldset>
  );
}

const EMPTY_ALLERGY = { substance: "", reaction: "", severity: "unknown" };
const EMPTY_MEDICATION = { name: "", dose: "", frequency: "" };
const SEVERITY = [
  ["unknown", "Severity"],
  ["mild", "Mild"],
  ["moderate", "Moderate"],
  ["severe", "Severe"],
];

export default function QuestionnaireForm({ submit }) {
  const [allergies, setAllergies] = useState([EMPTY_ALLERGY]);
  const [medications, setMedications] = useState([EMPTY_MEDICATION]);
  const mutation = useMutation({
    mutationFn: submit,
    onSuccess: () => reportWorkflow("questionnaire", "success"),
    onError: () => reportWorkflow("questionnaire", "failure"),
  });

  if (mutation.isSuccess)
    return (
      <div className="notice notice-ok" role="status">
        <CheckIcon />
        <p>Thank you, your answers were received.</p>
      </div>
    );

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
        hint="Medicines, foods or anything else that has caused a reaction."
        addLabel="Add another allergy"
        rows={allergies}
        setRows={setAllergies}
        empty={EMPTY_ALLERGY}
        fields={[
          { key: "substance", label: "Substance (e.g. penicillin)" },
          { key: "reaction", label: "Reaction (e.g. rash)" },
          { key: "severity", label: "Severity", options: SEVERITY },
        ]}
      />
      <Rows
        legend="Current medicines"
        hint="Include anything you take regularly, even vitamins or supplements."
        addLabel="Add another medicine"
        rows={medications}
        setRows={setMedications}
        empty={EMPTY_MEDICATION}
        fields={[
          { key: "name", label: "Medicine" },
          { key: "dose", label: "Dose (e.g. 500 mg)" },
          { key: "frequency", label: "How often" },
        ]}
      />
      <div className="q-group">
        <label className="field">
          <span className="label">
            Long-term conditions <span className="hint">· one per line</span>
          </span>
          <textarea name="conditions" rows={3} />
        </label>
        <label className="field">
          <span className="label">
            Past surgeries or procedures <span className="hint">· one per line, with the year if you know it</span>
          </span>
          <textarea name="surgeries" rows={3} />
        </label>
        <label className="field">
          <span className="label">Family history</span>
          <textarea name="familyHistory" rows={2} maxLength={5000} />
        </label>
        <label className="field">
          <span className="label">Anything else your doctor should know</span>
          <textarea name="other" rows={3} maxLength={5000} />
        </label>
      </div>
      {mutation.error && <div className="form-actions"><ErrorMessage error={mutation.error} /></div>}
      <div className="form-actions">
        <button className="btn-primary" aria-busy={mutation.isPending} disabled={mutation.isPending}>
          Send answers
        </button>
      </div>
    </form>
  );
}
