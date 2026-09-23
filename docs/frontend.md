# Frontend engineering

The SPA in `client/` (React 19, React Router 8, TanStack Query 5, Vite 8) is built to the frontend
specification: secure, fast, accessible, observable and testable by default. This page says how each
requirement is met, where it is enforced, and where we deliberately chose differently.

```
client/src
  main.jsx            router (code-split pages), providers, telemetry start
  routes.js           page loaders (shared by the router and intent prefetch)
  auth.jsx            session state; access token in memory only
  lib/                api client, telemetry, flags, route templates, safe redirects, formatting
  components/         shell (Root, Layout, AuthShell), Modal, Toaster, RouteError, forms, icons
  pages/              one module per route, each its own chunk (pages/patient/ for the patient side)
client/test           unit, component, integration (MSW) and contrast tests
e2e/                  journey, accessibility, resilience, performance (Playwright)
deploy/               nginx gateway, security headers, Prometheus, Grafana
```

## 1. Security

**Transport.** TLS terminates at the load balancer; the gateway answers any request that arrived over
plain HTTP (`X-Forwarded-Proto: http`) with `308` to HTTPS. HSTS is two years with subdomains.

**Headers** (`deploy/security-headers.conf`, the single source for nginx, `vite preview` and the e2e tests):

| Header | Value / purpose |
|---|---|
| Content-Security-Policy | everything `'self'`; no `unsafe-inline`, no `unsafe-eval`; `object-src`, `frame-src`, `worker-src`, `media-src` `'none'`; `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'`; **Trusted Types enforced** (`require-trusted-types-for 'script'; trusted-types 'none'`), so DOM-XSS sinks such as `innerHTML` throw; violations reported to `/api/v1/telemetry/csp` |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains` |
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `no-referrer` (patient upload links carry a token in the URL) |
| Permissions-Policy | camera, microphone, geolocation, payment, USB, serial, Bluetooth, topics all off |
| Cross-Origin-Opener-Policy / -Resource-Policy | `same-origin` |
| X-Frame-Options | `DENY` for old browsers; modern ones use `frame-ancestors` |

The API adds its own `default-src 'none'` CSP and `Cache-Control: no-store` (helmet, `server/src/app.js`).

**CORS.** The API allows only the origins in `CORS_ORIGINS` (validated URLs, no wildcard), with
credentials, an explicit method and header list, and a 10-minute preflight cache. In production the
SPA and API share an origin behind the gateway, so browsers never need CORS at all.

**Tokens and storage.** The 15-minute access token lives in a module variable, never in
`localStorage`/`sessionStorage`/IndexedDB (an e2e test asserts storage stays empty). The refresh token
is an `HttpOnly`, `SameSite=Strict` cookie scoped to `/api/v1/auth`. Signing out, or a failed refresh,
clears the token and every cached query, so patient data does not outlive the session.

**CSRF.** API calls authenticate with a bearer header that a cross-site page cannot attach, so they are
not CSRF-able. The only cookie-authenticated call, `/auth/refresh`, is `SameSite=Strict`, path-scoped
and checks the `Origin` header.

**XSS and rendering.** React escapes all text. `dangerouslySetInnerHTML`, `eval`, `new Function`,
`javascript:` URLs and `console` are lint errors (`.oxlintrc.json`). Trusted Types turns any remaining
DOM sink into an error the CSP report makes visible. User content (notes, questionnaire answers, OCR
text) is rendered as text only. Validation in the browser is for convenience; the server's strict zod
schemas are the boundary.

**Redirects and URLs.** The post-sign-in destination goes through `safeInternalPath`, so
`//evil.example`, `/\evil.example` and absolute URLs fall back to `/`. The API client only issues
relative requests below `/api/v1` (no `//`, no `..`), so data can never steer a request to another
host (the frontend's share of SSRF defence; the server never fetches user-supplied URLs).

**Secrets and logging.** The bundle contains no secrets: the only build-time value it reads is Vite's
`MODE`, and all configuration lives server-side. Source maps are not shipped. Telemetry sends route templates (`/cases/:id`), never
ids, tokens, names or emails, and error text is scrubbed in the browser and again on the server.

**Dependencies.** CI runs `npm audit --audit-level=high` and `npm audit signatures` (registry
signatures and provenance), gitleaks, and CodeQL; Dependabot proposes npm, GitHub Actions and Docker
updates weekly. Runtime dependencies are deliberately few: React, React Router, TanStack Query,
web-vitals and self-hosted fonts. No third-party scripts, CDNs or analytics run in the page.

## 2. Testing

| Layer | Where | What |
|---|---|---|
| Unit | `client/test/lib.test.js`, `api.test.js` | redirect safety, route templates and scrubbing, formatting, API client (request ids, path guard, single-flight refresh, expiry, network errors, aborts) |
| Design-token contrast | `client/test/contrast.test.js` | every text/background pair ≥ 4.5:1 and form-field borders ≥ 3:1, in both themes |
| Component | `client/test/components.test.jsx` | modal focus return, error announcement, toasts, questionnaire payload, upload form |
| Integration | `client/test/flows.test.jsx` (MSW fake API) | sign-in, wrong password, open-redirect refusal, return-to page, session expiry, keyboard shortcut, compiled record and citations, feature flag off, error boundary, 404 |
| API | `server/test/*.test.js` | auth, cases, pipeline, agent, telemetry, flags |
| End-to-end | `e2e/journey.spec.js` | doctor and patient journey under the production headers, zero CSP/Trusted Types violations |
| Accessibility | `e2e/accessibility.spec.js` | axe WCAG 2.2 A/AA on every screen in light and dark; skip link, focus after navigation, dialog containment and focus return; reflow at 320 px; 200 % text |
| Resilience | `e2e/resilience.spec.js` | wrong password, invalid patient link, 404, network failure, revoked session, sign-out, telemetry delivery without identifiers |
| Performance | `e2e/performance.spec.js`, `client/scripts/check-bundle.js` | LCP/CLS under 4G and slow 3G with a 4× slower CPU, record render time and interaction latency; bundle-size budgets |

`npm test` runs the server and client suites, `npm run build` enforces the bundle budget, and
`npm run e2e` runs every Playwright spec against the production build. CI runs all of them on every
pull request; make the `checks` and `e2e` jobs required status checks in the branch protection rules
so a failure blocks the merge.

## 3. Performance

**Targets** (Core Web Vitals "good", at the 75th percentile of real users, as CrUX reports them):
LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; supporting TTFB ≤ 0.8 s and FCP ≤ 1.8 s.

**Budgets enforced in CI:** initial JavaScript ≤ 130 kB gzip (today about 114 kB), CSS ≤ 14 kB
(about 8 kB), any page chunk ≤ 20 kB (the largest is about 4 kB); lab LCP < 2.5 s on 4G with a 4× CPU
slowdown and < 8 s on slow 3G, CLS < 0.1, record ready < 4 s, interaction latency < 200 ms.

**Loading.** Every page is its own chunk (`routes.js`); React, the router and TanStack Query sit in a
`vendor` chunk that survives app deploys in the cache. The two above-the-fold fonts are preloaded;
the rest load on demand by `unicode-range`. Hovering or focusing a case link prefetches that page's
code and data (`lib/prefetch.js`, behind the `intent-prefetch` flag), so the click renders from
cache. Images are fetched as blobs with fixed dimensions and `decoding="async"`, so nothing shifts.

**Rendering.** Long record sections use `content-visibility: auto`, so off-screen sections skip
layout and paint. Queries are cancelled through `AbortSignal` when a page unmounts or its key
changes, and polling runs only while a source is still processing.

**Caching.** Hashed assets: `Cache-Control: public, max-age=31536000, immutable`. The app shell:
`no-cache` with an `ETag`, so a deploy is visible on the next load and unchanged loads get a `304`.
In the page, TanStack Query serves cached data at once and revalidates in the background
(stale-while-revalidate, 30 s). API responses stay `no-store` (see decisions below).

**Compression.** The build writes `.br` (quality 11) and `.gz` (level 9) next to each compressible
file. The gateway serves the `.gz` files with `gzip_static` and gzips anything else on the fly; Brotli
is served by the CDN edge, or by the gateway if its image includes `ngx_brotli`.

## 4. Observability

```
browser ──(sendBeacon)──► /api/v1/telemetry ──► Prometheus ◄── API /metrics ◄── worker :9464/metrics
   │ X-Request-Id per call     frontend_* series              http_*, llm_*, agent_*, pipeline_*, mongodb_*
   └──────────────────────────────► API log line (pino, requestId, userId) ──► the agent and DB work it caused
```

**Real-user monitoring** (`lib/telemetry.js`, about 2 kB plus web-vitals): LCP, INP, CLS, FCP, TTFB
per page template; the navigation broken into DNS, TCP, TLS, TTFB, download and DOM-interactive;
every API call's browser-side latency and status (including "network" failures); runtime errors,
unhandled rejections, render crashes (caught by the route error boundary) and stale-deploy chunk
failures; the outcome of each key workflow (login, register, create case, upload, questionnaire,
upload link, exports, deletion); and CSP violations. Batches go out with `sendBeacon` every 5 s and
when the tab is hidden. The endpoint validates each event, maps routes to an allowlist so labels stay
bounded, rate-limits, and never stores personal data.

**Correlation.** Every request carries a fresh `X-Request-Id`; the API logs it with the user and the
outcome, and error messages for server faults show its first 8 characters as a support reference.

**Dashboards** (`deploy/grafana/dashboards/docdoc.json`): the existing API, pipeline and LLM panels,
plus a *Frontend: real users* row (web vitals, CLS, poor-sample share, network phases, errors, failed
workflows, API failures seen by browsers, CSP violations) and a *Database* row (command latency and
errors, pool use, heartbeat and checkout failures). The *Where API latency comes from* panel plots
browser, server and database p95 together: a gap between the first two is network or gateway; server
time tracking database time points at queries.

**Feature flags** (`server/src/modules/flags/flags.js`, `client/src/lib/flags.js`). Flags are declared
in code with a default rollout percentage; `FEATURE_FLAGS="intent-prefetch=25,keyboard-shortcuts=off"`
overrides them. Doctors are bucketed by a stable hash of flag and user id, so a partial rollout
is consistent per person; anonymous visitors see only fully rolled-out flags. Changing a rollout means
changing the environment and restarting the API; the frontend is not rebuilt or redeployed. If
`/flags` fails, the client falls back to the declared defaults.

## 5. Accessibility (WCAG 2.2 AA)

* **Structure:** landmarks (`header`, `nav`, `main`, `aside`), one `h1` per page, labelled sections,
  real tables with headers, native `dialog`, `details`, `select`, and buttons (no clickable `div`s).
* **Navigation:** a skip link is the first focusable element; after every client-side navigation focus
  moves to `main` and the new page title is announced; every page has a unique `document.title`.
* **Keyboard:** everything works by keyboard; focus indicators are visible; the sticky header never
  covers the focused element (`scroll-padding-top`, 2.4.11); Ctrl/Cmd+K focuses case search (a
  modifier chord, so it can't fire while typing, 2.1.4) and is exposed with `aria-keyshortcuts`.
* **Dialogs:** native modal dialogs make the page behind inert, move focus inside (to the field that
  needs input, where there is one), close on Escape, and return focus to the control that opened them.
* **Forms:** visible labels; errors are announced (`role="alert"`), tied to their fields with
  `aria-describedby` and flagged with `aria-invalid`; the password rule is stated before input.
* **Dynamic content:** toasts announce through a polite status region, pause on hover or focus, and
  can be dismissed; the case page announces when AI processing of a document finishes or fails;
  loading states use `role="status"` and `aria-busy`.
* **Visual:** contrast is tested against the design tokens (text ≥ 4.5:1, field borders ≥ 3:1) in both
  themes; state is never shown by colour alone (icons and text accompany every pill, alert and flag);
  font sizes are in `rem`, so browser text settings apply; content reflows at 320 px; targets are at
  least 24 px (2.5.8); `prefers-reduced-motion` and Windows high contrast (`forced-colors`) are supported.

Automated checks catch only part of what matters. Before a release, also do a manual pass with
VoiceOver (Safari) and NVDA (Firefox) through the journey: sign in, open a case, open a citation,
upload as a patient.

## 6. Decisions where the specification and this product pull apart

| Spec item | Decision | Why |
|---|---|---|
| HTTP caching, ETag, CDN caching for data | Static assets are cached and revalidated (immutable / ETag); **API responses stay `no-store`**; stale-while-revalidate happens in memory (TanStack Query) | API responses are patient records. Shared or disk caches would keep them after sign-out and on shared hospital computers. |
| Virtualise large lists | `content-visibility: auto` instead of windowing | A compiled record is a document: find-in-page, printing and screen-reader browsing must see every entry. Records are at most about 2 000 facts; revisit if that grows. |
| `prerender` / speculation rules | Not used; intent prefetch of code and data instead | Pages are behind sign-in and show patient data; speculative prerendering would load records the doctor never opened, and speculation rules need inline scripts the CSP forbids. |
| `preconnect`, `dns-prefetch` | Not needed | Everything is same-origin: there is no other host to connect to. Font preload and module preload cover the critical path. |
| Brotli | Built at compile time; served by the CDN or an `ngx_brotli` gateway; stock nginx serves prebuilt gzip | The official nginx image has no Brotli module, and a third-party nginx build would add supply-chain risk. |
| HSTS preload | Header ready (`includeSubDomains`), **not submitted to the preload list** | Preloading is effectively irreversible and requires every subdomain to serve HTTPS: the domain owner's call. |
| Third-party error monitoring (e.g. Sentry) | Self-hosted telemetry into Prometheus | Keeps `connect-src 'self'`, and sends nothing patient-adjacent to another processor without a data-processing agreement. |
| Feature flags "without redeploying" | Server-side flags; changing a rollout needs an API restart, not a frontend build | Auditable in configuration history, no new service. For instant toggles, back `flags.js` with a database collection or a flag service. |
| Strong type safety | JavaScript with strict runtime validation (zod at every API boundary, validated telemetry, lint), not TypeScript yet | A TypeScript migration is the right next step (`checkJs` first, then `.tsx` page by page); it was left out of this change to avoid rewriting every file at once. |
