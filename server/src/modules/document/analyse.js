// Analyser annotations. They sit *beside* the patient data and never change it:
// each one names the facts it is about, so a doctor can check the originals.

const words = (s) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const NO_ALLERGIES = /\b(no known (drug )?allergies|nkda|nka)\b/i;
const RANGE = /(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)/;
const NUMBER = /-?\d+(?:\.\d+)?/;

export function findConflicts(facts) {
  const conflicts = [];
  const allergies = facts.filter((f) => f.category === "allergy");
  const denials = allergies.filter((f) => NO_ALLERGIES.test(`${f.label} ${f.value ?? ""}`));
  const recorded = allergies.filter((f) => !denials.includes(f));

  if (denials.length && recorded.length) {
    conflicts.push({
      kind: "allergy_denial",
      message: "One source states no known allergies, but allergies are recorded elsewhere",
      factIds: [...denials, ...recorded].map((f) => f.id),
    });
  }

  // literal name match only: drug-class knowledge (penicillin → amoxicillin) is out of scope
  for (const allergy of recorded) {
    const substance = words(allergy.label).join(" ");
    for (const med of facts.filter((f) => f.category === "medication")) {
      if (substance && ` ${words(med.label).join(" ")} `.includes(` ${substance} `)) {
        conflicts.push({
          kind: "drug_allergy",
          message: `Medication "${med.label}" matches recorded allergy "${allergy.label}"`,
          factIds: [allergy.id, med.id],
        });
      }
    }
  }

  // same test, same written date, different values
  const labs = new Map();
  for (const lab of facts.filter((f) => f.category === "lab_result" && f.date && f.value)) {
    const key = `${words(lab.label).join(" ")}|${lab.date}`;
    labs.set(key, [...(labs.get(key) ?? []), lab]);
  }
  for (const group of labs.values()) {
    if (new Set(group.map((f) => f.value.trim().toLowerCase())).size > 1) {
      conflicts.push({
        kind: "lab_mismatch",
        message: `${group[0].label} on ${group[0].date} has different values in different sources`,
        factIds: group.map((f) => f.id),
      });
    }
  }
  return conflicts;
}

/** "below"/"above" only when the value and a printed reference range are both in the cited text. */
export function rangeFlag(fact) {
  // the measured number is the first one in the value once any printed range is removed from it
  const value = Number(fact.value?.replace(RANGE, "").match(NUMBER)?.[0]);
  const range = `${fact.value ?? ""} ${fact.details ?? ""} ${fact.quote}`.match(RANGE);
  if (Number.isNaN(value) || !range) return undefined;
  const [low, high] = [Number(range[1]), Number(range[2])];
  if (low >= high) return undefined;
  if (value < low) return "below";
  if (value > high) return "above";
  return undefined;
}
