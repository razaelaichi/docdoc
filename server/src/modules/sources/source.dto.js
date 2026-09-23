export const toSourceDto = ({ _id, uploadedBy, kind, note, questionnaire, file, processing, copiedFrom, createdAt }) => ({
  id: String(_id),
  uploadedBy,
  kind,
  note,
  questionnaire,
  file: file?.storageKey ? { name: file.originalName, mimeType: file.mimeType, size: file.size } : undefined,
  processing: processing && {
    status: processing.status,
    error: processing.error,
    pages: processing.pages,
    aiStructured: processing.aiStructured,
    factCount: processing.factCount,
    uncoveredPages: processing.uncoveredPages,
    lowConfidencePages: processing.lowConfidencePages,
  },
  // where a record in a patient's personal record came from (a linked visit), if not uploaded directly
  fromVisit: copiedFrom?.sourceId ? { doctorName: copiedFrom.doctorName } : undefined,
  createdAt,
});
