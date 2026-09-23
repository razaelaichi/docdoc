import mongoose from "mongoose";

// Extracted text per page, kept apart from the source so case listings stay small.
// This is the ground truth every AI citation is checked against.
const sourceTextSchema = new mongoose.Schema(
  {
    sourceId: { type: mongoose.Schema.Types.ObjectId, ref: "Source", required: true, unique: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true, index: true },
    pages: [
      {
        page: Number,
        text: String,
        method: { type: String, enum: ["text-layer", "ocr", "metadata", "entered"] },
        confidence: Number, // OCR only, 0-100
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

export const SourceText = mongoose.model("SourceText", sourceTextSchema, "source_texts");
