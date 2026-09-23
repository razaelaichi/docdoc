export const toCaseDto = ({ _id, patientName, linkedPatientId, createdAt, updatedAt }) => ({
  id: String(_id),
  patientName,
  linkedPatient: Boolean(linkedPatientId), // the patient linked this case to their DocDoc account
  createdAt,
  updatedAt,
});

export const toUploadLinkDto = ({ _id, expiresAt, revokedAt, createdAt }) => ({
  id: String(_id),
  expiresAt,
  revokedAt,
  createdAt,
  active: !revokedAt && expiresAt > new Date(),
});
