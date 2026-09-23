// What a doctor learns about a share: its state and dates, and the email they typed themselves.
export const toShareForDoctorDto = ({ _id, status, requestedBy, patientEmail, createdAt, respondedAt, endedAt }) => ({
  id: String(_id),
  status,
  requestedBy,
  patientEmail: requestedBy === "doctor" ? patientEmail : undefined,
  requestedAt: createdAt,
  respondedAt,
  endedAt,
});

// What a patient sees: who asked, what they answered, and when the doctor last looked.
export const toShareForPatientDto = ({ _id, status, requestedBy, doctor, createdAt, respondedAt, endedAt, lastAccessedAt }) => ({
  id: String(_id),
  status,
  requestedBy,
  doctor: doctor ? { name: doctor.name, email: doctor.email } : { name: "A doctor" },
  requestedAt: createdAt,
  respondedAt,
  endedAt,
  lastAccessedAt,
});

export const toPersonalRecordDto = (record, { total, linkedVisits, activeShares, pendingRequests }) => ({
  id: String(record._id),
  name: record.patientName,
  documents: total,
  linkedVisits,
  activeShares,
  pendingRequests,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});
