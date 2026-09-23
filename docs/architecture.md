# Architecture

```
Browser (React SPA) ──► nginx gateway ──► API (Express, /api/v1) ──► MongoDB (Atlas)
                         CSP, rate limit      auth → validation →        ▲
                         /metrics blocked     routes → services →        │
                                              repositories               │
                                                                         │
                         Worker (separate process) ── claims sources ────┘
                           extract (pdf.js / Tesseract OCR / DICOM tags)
                           structure (agent → NVIDIA NIM, tool-restricted)
                           save text + facts + status in one transaction
```

* **API and worker are separate processes** (bulkhead): OCR and LLM latency never block API requests.
* **Layers** (`server/src/modules/<feature>/`): `*.routes.js` (HTTP, validation, DTOs) → `*.service.js`
  (business rules, ownership, audit) → `*.repository.js` (Mongoose queries). Cross-cutting code lives in
  `lib/` (config, errors, logging, metrics, storage, mail) and `middleware/`.
* **The compiled record is computed on read** from stored facts (`document/compile.js`), so it is always
  current and there is no second copy of clinical data to keep consistent.

## Patients and their health record

Doctors and patients are both `users`, told apart by `role`; each role has its own routes
(`/api/v1/cases` for doctors, `/api/v1/me` for patients) behind a role check.

* **Personal health record.** A patient's record is a `cases` document with `kind: "personal"` owned by
  the patient (one per patient, unique index). It reuses everything a doctor's case has: uploads with
  duplicate detection, the extraction/AI pipeline, cited facts, the compiled record, PDF and FHIR export.
* **Records from a visit.** When a signed-in patient opens a doctor's upload link, the doctor's case
  is linked to them (`linkedPatientId`, one patient per case). Every processed source in that case,
  including what the doctor uploaded, is copied into the patient's record: a separate copy of the file,
  plus its extracted text and verified facts, so nothing is re-run through the AI. The pipeline
  mirrors anything processed later. Copies remember their origin (`copiedFrom`), are made at most once,
  and are skipped when the patient already holds the same file.
* **Sharing with a doctor.** A `record_shares` document grants one doctor's case read access to the
  patient's record. A doctor asks by email (`pending`, the same response whether or not the email has an
  account, and it waits for a later sign-up), or the patient offers it from the doctor's link. The
  doctor sees the record at `/cases/:id/shared-record/*` only while the share is `active`; that is
  checked on every request, so removing access takes effect immediately. Each view is audited and
  stamps `lastAccessedAt`, which the patient sees.
* **Why copy instead of pointing to the doctor's case?** The patient's record must outlive the doctor's
  case (a doctor may delete it) and must not depend on the doctor's permissions; copies are
  independent, and facts carry their own citations into the copy.

```
doctor case ── link opened by the patient ──► copies ──► patient's personal record (cases, kind=personal)
                                                                  │
new doctor's case ◄── record_shares (pending → active → revoked) ─┘  read-only, audited, revocable
```

## Pipeline

1. Upload → magic-byte type check → stored under a random key → `source` created with `processing.status = pending`.
2. Worker atomically claims the next due source (`findOneAndUpdate`, 20-minute lease, so a crashed
   worker's job is retried), extracts text per page, and — if an API key is configured — runs the
   structuring agent.
3. The agent may only call `read_page`, `record_facts` and `finish`, all bound server-side to that one
   document. `record_facts` rejects any fact whose quote is not verbatim on the cited page.
4. Text, facts and status are written in one transaction; reprocessing replaces them (idempotent).
5. Failures retry with exponential backoff (max 3 attempts); unsupported content fails immediately with a
   client-safe message.

## Collections

| Collection | Holds | Key indexes (query they serve) | Lifecycle |
|---|---|---|---|
| `users` | doctors, patients, admins; argon2id hash, lockout counters | `email` unique (login) | until deleted |
| `refresh_tokens` | hashed refresh tokens, grouped by login `familyId` | `tokenHash` unique (refresh), `familyId` (revoke session), `userId` (revoke all), `expiresAt` TTL | auto-deleted at expiry |
| `user_tokens` | hashed single-use email tokens | `tokenHash` unique, `expiresAt` TTL | auto-deleted at expiry |
| `cases` | a doctor's case (`clinical`) or a patient's own record (`personal`); `linkedPatientId` when a visit is linked | `{ownerId, createdAt}` (a doctor's list), `{ownerId, idempotencyKey}` unique partial (create retries), `ownerId` unique partial on `personal` (one record per patient) | clinical: until the doctor deletes it; personal: the patient's |
| `record_shares` | a doctor case's access to a patient's record, with status and timestamps | `doctorCaseId` unique partial on `live` (one open request or grant per case), `{patientId, status}`, `{patientEmail, status}` | deleted with the doctor's case; the patient's record is untouched |
| `upload_links` | hashed patient link tokens | `tokenHash` unique (patient access), `caseId` (list), `expiresAt` TTL | auto-deleted at expiry |
| `sources` | one file / note / questionnaire + processing state (+ `copiedFrom` on visit copies) | `{caseId, createdAt}` (source list), `{caseId, file.sha256}` unique partial (dedupe), `{caseId, copiedFrom.sourceId}` unique partial (copy once), `{processing.status, processing.nextAttemptAt}` (worker queue) | deleted with the case |
| `source_texts` | extracted text per page | `sourceId` unique, `caseId` | deleted with the case |
| `facts` | one cited fact | `{caseId, category}` (compile by section), `sourceId` (replace on reprocess) | deleted with the case |
| `audit_logs` | append-only security events | `{actorId, createdAt}`, `{action, createdAt}` | retained (see privacy doc) |

**Embedding vs referencing.** Sources, texts and facts reference their case rather than being embedded:
a case can collect hundreds of documents and thousands of facts (16 MB document limit), each is written
independently by the worker, and facts are read by category. Page texts live apart from `sources` so
case listings never load full document text. The questionnaire *is* embedded in its source: it is small,
written once and always read with it.

**Consistency.** Multi-document writes (pipeline results, case deletion) use transactions. Races are
closed with atomic operations and unique indexes: token consumption (`findOneAndUpdate` on
`usedAt/revokedAt: null`), job claiming, idempotent case creation, duplicate-file detection.
