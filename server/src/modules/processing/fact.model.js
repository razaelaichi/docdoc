import mongoose from "mongoose";

export const FACT_CATEGORIES = [
  "allergy",
  "medication",
  "condition",
  "procedure",
  "lab_result",
  "vital_sign",
  "imaging_finding",
  "encounter",
  "immunization",
  "family_history",
  "social_history",
  "other",
];

// One clinical fact copied out of a source, always with its evidence (page + verbatim quote).
// Referenced, not embedded: a case can accumulate thousands and they are queried by category.
const factSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, ref: "Source", required: true, index: true },
    origin: { type: String, enum: ["document", "patient-reported"], required: true },
    category: { type: String, enum: FACT_CATEGORIES, required: true },
    label: { type: String, required: true, maxlength: 200 },
    value: { type: String, maxlength: 500 },
    date: { type: String, maxlength: 50 }, // as written in the source; never reformatted
    details: { type: String, maxlength: 1000 },
    page: { type: Number, required: true },
    quote: { type: String, required: true, maxlength: 600 },
  },
  { timestamps: true }
);

factSchema.index({ caseId: 1, category: 1 }); // the compiled document reads facts section by section

export const Fact = mongoose.model("Fact", factSchema);
