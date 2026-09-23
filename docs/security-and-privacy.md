# Security & privacy

## Identity and access
* Doctors register and sign in. Passwords: argon2id (OWASP parameters), 12–128 chars.
* 15-minute JWT access token held in memory by the SPA; 7-day opaque refresh token in an `HttpOnly`,
  `SameSite=Strict` cookie scoped to `/api/v1/auth`, rotated on every use. Replaying a used refresh
  token revokes the whole session. Password reset revokes every session.
* 5 failed logins lock the account for 15 minutes. Wrong-password and unknown-email responses are
  identical in content and timing; sign-up and password-reset responses never reveal whether an account exists.
* Authorization is server-side on every request: role (`doctor`) + **ownership**
  (every case query includes `ownerId`; another doctor's case is a 404). Admins get no patient-data access.
* Patients can use a 7-day, revocable, single-case upload link (random 192-bit token, stored hashed) without
  an account: it adds documents and answers and cannot read anything back.
* Patients can also have an account (`role: patient`, same password and session rules as doctors).
  Every `/api/v1/me` route is scoped to the signed-in patient's own record; there is no id in those
  URLs that could point elsewhere. Patients are refused on doctor routes and doctors on patient routes.
* **A doctor sees a patient's own record only with the patient's approval**, per case, checked on every
  request (`record_shares`, status `active`). Removing access is immediate. Requests by email never reveal
  whether an account exists, and they reach an account only after it has **confirmed its email**
  (48-hour single-use link), so nobody can sign up with someone else's address and answer a doctor on
  their behalf. The patient sees who asked, who has access and when each doctor last looked;
  every view, download and export is in `audit_logs` with `via: patient-share`.
* Opening a doctor's link while signed in links that case to the patient (one patient per case) and
  copies its records into the patient's record. The doctor sees only that the case is linked.

## Input, files, output
* Every body/query/param is validated with strict zod schemas (unknown keys rejected). Mongoose
  `sanitizeFilter` blocks operator injection; our own operators are explicitly `mongoose.trusted`.
* Uploads: type from magic bytes (PDF, JPEG, PNG, WebP, HEIC, TIFF, DICOM only), 15 MB × 10 files,
  random storage keys (no user-controlled paths), files served only as `attachment` with `nosniff` and
  `Cache-Control: no-store`. *Not yet:* antivirus scanning (plug ClamAV into `source.service.js` before `putObject`).
* Responses go through DTOs; errors are generic outside `AppError`; logs redact auth headers, cookies and
  patient-link tokens in URLs.

## Browser
* HTTPS only (gateway `308` for plain HTTP, HSTS two years). Strict CSP with no `unsafe-inline` or
  `unsafe-eval`, **Trusted Types enforced**, `frame-ancestors 'none'`, violation reports to
  `/api/v1/telemetry/csp`; plus `nosniff`, `no-referrer`, a locked-down `Permissions-Policy`, and COOP/CORP
  `same-origin`. One file, `deploy/security-headers.conf`, feeds nginx, `vite preview` and the e2e tests.
* No token in web storage; post-login redirects are same-origin only; the API client refuses
  non-relative paths; `dangerouslySetInnerHTML`, `eval` and `console` are lint errors.
* Browser telemetry carries route templates and scrubbed messages only: no ids, tokens, names or emails.
* Details, tests and trade-offs: [frontend engineering](frontend.md).

## AI agent
* The agent is not trusted. It runs in the worker with no database, filesystem, network or credential
  access; it can call three tools bound server-side to one document. Every call passes an allowlist,
  per-tool cap, size limit, JSON parse, schema validation and timeout, and is audited.
* Limits per document: turns, total tokens, per-turn tokens, wall-clock time. Provider replies are
  schema-checked; a circuit breaker stops calls to a failing provider.
* Prompt injection: fixed system instructions; document text only inside `<untrusted_document>`
  delimiters that document content cannot close; no tool can act outside the current document; and
  every recorded fact must quote text that verifiably exists on the cited page.

## Data inventory

| Data | Why | Where | Who can access | Retention |
|---|---|---|---|---|
| Doctor name, email, password hash, login timestamps | accounts, security | MongoDB `users` | the doctor; operators | until account deletion (manual for now) |
| Patient name | identify the case | `cases` | owning doctor | until the doctor deletes the case |
| Patient account (name, email, password hash) | the patient's own record | `users` | the patient; operators | until account deletion (manual for now) |
| Personal health record: files, notes, questionnaires, texts, facts | the patient's own history | `cases` (personal), `sources`, `source_texts`, `facts` | the patient; doctors the patient approved, while approved | the patient's (no self-service deletion yet) |
| Access requests and grants (doctor, patient email, status, dates, last viewed) | consent and its history | `record_shares` | the patient; the requesting doctor (status only) | deleted with the doctor's case |
| Uploaded files, notes, questionnaires | the purpose of the product | object storage + `sources` | owning doctor | until case deletion |
| Extracted text and facts | the compiled record | `source_texts`, `facts` | owning doctor | until case deletion |
| Security events (IP, action, ids — no clinical content) | audit | `audit_logs` | operators | define per policy (e.g. 1 year) |

**Third-party processing:** when `NVIDIA_API_KEY` is set, document text is sent to NVIDIA's hosted NIM API
for structuring. Review NVIDIA's data terms before enabling it with real patient data, or point
`NIM_BASE_URL` at a self-hosted NIM. DICOM extraction deliberately skips patient-identifier tags.

**Deletion:** `DELETE /api/v1/cases/:id` removes the case, its sources, texts, facts and links in one
transaction, deletes the stored files, and writes an audit entry.

## Known gaps
* Access tokens remain valid up to 15 minutes after logout or password reset.
* Two tabs refreshing at the exact same instant trip replay detection (user must sign in again).
* Patients can't yet delete individual documents or their whole account themselves; add both before
  launch (the right to erasure), mirroring the doctor's case deletion.
* Records copied from a visit before the doctor reprocessed a document are refreshed only when that
  reprocessing finishes; a document the doctor deletes stays in the patient's record (it is theirs).
* Rate-limit counters are per process; use a Redis store before running several API instances.
* HSTS is not on the browser preload list (an irreversible step for the domain owner).
* Brotli needs a CDN or an `ngx_brotli` gateway; the stock image serves prebuilt gzip.
* No virus scanning; no account self-deletion endpoint; audit log tamper-resistance relies on the
  application plus DB permissions (grant the app user `insert`/`find` only on `audit_logs`).
