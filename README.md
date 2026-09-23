# DocDoc

Collects a patient's records — documents and scans from any hospital, plus what the patient reports —
and compiles them into one structured, fully cited record for the treating doctor.
Every entry is copied verbatim from a source and cited `[S# p.#]`; nothing is inferred.

MERN monorepo (npm workspaces): `server/` Express API + background worker, `client/` React (Vite) SPA.
See `docs/` for [architecture](docs/architecture.md), [frontend engineering](docs/frontend.md),
[security & privacy](docs/security-and-privacy.md) and [operations](docs/operations.md).

## Run locally

```bash
npm install
cp server/.env.example server/.env    # set MONGODB_URI, JWT_ACCESS_SECRET; optionally NVIDIA_API_KEY, SMTP_URL
npm run dev -w server                 # API        http://localhost:4000
npm run dev:worker -w server          # processing worker
npm run dev -w client                 # web app    http://localhost:5173
```

Without `SMTP_URL`, emails (verification, password reset) are printed in the API log.
Without `NVIDIA_API_KEY`, documents are text-extracted but not structured into facts.

## Checks

```bash
npm run lint     # oxlint, zero warnings
npm test         # API, pipeline, agent tests + client unit, integration and contrast tests
npm run e2e      # journey, accessibility (axe, keyboard), resilience and performance specs (Playwright)
npm run build    # production build + bundle-size budget
```

## Flow
Doctors sign in at `/login`; patients at `/patient/login` and keep their own health record.

1. Doctor creates a case and sends the patient a one-time upload link.
2. Patient uploads documents/photos/scans and fills in a questionnaire (allergies, medicines, history).
3. The worker extracts text (PDF text layer, OCR, DICOM tags) and an AI agent records cited facts.
4. Doctor opens the compiled record: alerts and cross-checks first, every entry linked to its source
   page; export as PDF (with scans and full-text appendix) or FHIR R4.
5. A patient with an account keeps everything in one personal health record: they upload directly
   (duplicates are skipped), and a doctor's link opened while signed in adds that visit automatically.
6. A new doctor asks for the record by email; once the patient approves, the doctor sees the full
   history at once. The patient can remove access at any time.
