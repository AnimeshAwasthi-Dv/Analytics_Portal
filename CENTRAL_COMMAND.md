# Dectrocel Command

The active frontend uses the actual Common PACS admin application, imported from `C:/Dectrocel/Dev_phase_2/marengo_portal/common-pacs/src` into `frontend/src/pacs`. The source checkout was at commit `07fd96b205c06c0abde90690476856522d5ac45f`; its local working files were copied. Its worklist, report library/editor, patient profiles, client/center drawers, operations screens, viewer components and PACS styles are retained. This is a source-code integration, not the earlier menu-only interface.

The previous central UI is preserved under `archive/previous-central-ui/src` and is outside the active build. `frontend/src/main.tsx` loads only the PACS application and `frontend/src/central` enhancements. The central sign-in page is purpose-built for Dectrocel; it does not use the source hospital login artwork.

## Workspace behavior

- `/command`: organization totals and portal directory, using the PACS shell and visual language.
- `/portal/marengo/dashboard`, `/portal/goyal/dashboard`, `/portal/pacs/dashboard`: full PACS admin workspaces, each connected to its own source database.
- Each PACS workspace has all 22 Common PACS super-admin tabs plus Healthcheck, Analysis assistant, Connections and Access controls. The source Studies tab is displayed as Worklist, as in its original workstation.
- The sidebar groups the familiar source labels into Workstation, Command, Access Management, Operations, Platform, Intelligence, Governance and Central tools. Find a tab searches the current workspace.
- Portal selection remounts the entire workspace to clear the previous portal's component state. Paths, browser Back/Forward and viewer links preserve the source identity. Report caches include portal identity.
- `/portal/onprem/dashboard` exposes source license/workstation inventory, analytics, central audit and connections. It does not manufacture a PACS worklist for an on-prem licensing schema.
- All portals returns to organization scope. Internal team and organization audit belong to this scope.

## Database connections

All five connections were verified with read-only `SELECT 1` on 2026-11-01: central, supplied Marengo staging, Goyal, Common PACS and the on-prem license server. The Goyal and PACS URLs were discovered in their supplied code directories. Existing explicitly supplied Marengo and on-prem URLs were retained. Connection credentials are in ignored `backend/.env`; none belong in frontend settings.

| Purpose | Environment key |
| --- | --- |
| Central snapshots, authentication and audit | `DATABASE_URL` |
| Marengo source | `MARENGO_DATABASE_URL` |
| Dedicated Goyal source | `GOYAL_DATABASE_URL` |
| Common PACS source | `PACS_DATABASE_URL` |
| On-prem source | `ONPREM_DATABASE_URL`, falling back to `SOURCE_LICENSE_DATABASE_URL` |

Read adapters and sync enforce PostgreSQL read-only transactions, UTC, statement/lock/connect timeouts, bounded pages and bound query values. Prisma-only connection options such as `schema` are removed before passing the URL to the PostgreSQL driver. No source schemas or triggers are changed by `command_sync` or the new PACS adapter.

Separate `*_CONTROL_DATABASE_URL` settings enable the audited control worker. The local configuration uses the supplied credentials for matching source databases. The worker verifies host/port/database identity, requester's current permissions and supported action before applying an absolute desired state.

Goyal MRI's group and Main Center inside Common PACS were verified in the source directory and mapped by exact immutable IDs to canonical client `goyal` using `COMMAND_CENTER_CLIENT_MAP`. Existing central facts for those IDs were reclassified. Portal-specific reports remain separate; canonical Goyal analytics combines dedicated and mapped shared-PACS usage. Distinct jobs in separate portals are not deduplicated into a clinical study count.

## PACS data adapter

`backend/app/pacs_api.py` provides `/api/pacs/{portal}/...`. `frontend/src/central/transport.ts` adapts the copied frontend's requests to this API. Authentication uses the existing HTTP-only central cookie. The copied interface receives an opaque session marker, never a stored bearer credential. Its SUPER_ADMIN layout role does not grant server permissions: every request checks the real central team role.

Connected reads include the organization directory and counts, users/radiologists, services/subscriptions, worklist studies and jobs, report summaries/full report JSON, patient profiles/history, follow-ups, feedback, demo/call requests, queries/support messages, notification history/recipients, technical incidents, source audit and database health. Source field lists explicitly exclude credentials, tokens and storage paths. Missing scope columns reject the query rather than silently broadening it. Source worklists use keyset pages; overview report/processing lists show the latest 200 records and disclose truncation when applicable. Full report JSON is retrieved when opening a report, not selected for list payloads.

Clinical records are restricted to super_admin, operations and support. Analyst, finance and viewer roles use central analytics and connection views. Source and central audit also require `audit:read`. Queries use actual support tickets, not an assumed queries table. Patient histories use verified source relations; dates in source audit use bounded inclusive IST ranges. CSV values are escaped against spreadsheet formulas.

## Actions and current limits

Access controls offers source user, service and subscription inventory with a reason, review step, idempotency key and request history. On-prem inventory offers license/workstation access reviews. Center access is supported by the audited command API. The worker protects source super-admin users and records applied/failed outcomes; refresh/sync shows the observed source state. No source control commands were submitted during development or browser verification.

Copying an interface does not connect its clinical services. DICOM uploads, non-viewer binary downloads, report approval/editing/push, support/WhatsApp mutations, patient creation, routing, billing and source configuration updates still require the original authenticated PACS service integration. Unsupported requests return a clear integration error and do not perform generic SQL writes. Messaging runtime readiness is not inferred from database access. Database health does not claim portal runtime uptime. Legacy billing/license pages in the archived UI are not mounted.

Central analytics counts reported studies as successful modality endpoint uses, unprocessed studies as a separate inventory, source usage credits and verified user audit activity separately. Raw processing attempts remain separate technical records. Portal/client/center/service group and inclusive IST dates are supported, up to 366 days. Durations use recorded submission-to-report times (receipt when submission is absent), include queue/review time and exclude invalid timestamps. User audit rankings do not imply attributed service consumption. On-prem offline AI service usage needs workstation telemetry; its shared credit pool cannot establish service-level attribution.

## Conversational AI assistant

The Analysis assistant tab now opens a genuine conversational model integration, rather than the former phrase-matching form. It uses the [OpenAI Responses API and function calling](https://developers.openai.com/api/docs/guides/function-calling), with server-owned conversation history, validated data tools, and user-owned chart/evidence cards. Natural questions, follow-ups, comparisons, explanations, English/Hindi requests and spelling variations are handled by the model rather than a command grammar.

Configure the ignored `backend/.env` on the server:

```dotenv
OPENAI_API_KEY=your-server-api-key
ASSISTANT_MODEL=gpt-5.4
ASSISTANT_REASONING=low
ASSISTANT_ENABLED=true
```

Restart the backend after changing these values. Never add the key to frontend/VITE variables. The local installation has the configuration fields prepared, but no API key was supplied: live model generation remains unconfigured until a valid key and model access are available. The UI shows this status explicitly and does not substitute canned/rules-based answers. ChatGPT authentication is separate from this application's API credentials.

The model can discover portal/center names, query the existing measured analytics, compare periods/portals/clients with server-calculated deltas, inspect snapshot sync state, and summarize access-resource counts. Goyal client scope includes its mapped shared-PACS centers. Every data card includes exact filters, dataset citations, retrieval time and measurement definitions; cards retain the retrieved snapshot. The same weighted X-ray definitions and reported-study accounting used by Analytics apply. Changes from a zero baseline have undefined percentage change; missing entries in bounded rankings are never invented as zero.

Queries are validated and parameterized by application code. There is no model-generated SQL, arbitrary URL fetch, source connection, patient/report/DICOM tool, license-key output or mutation tool. The provider receives the user's prompts, conversation text and requested operational summaries, including registered center names and user activity display names when retrieved. Credentials and patient-level records are not sent by the data tools. API requests use `store:false`; this is not a claim about the provider's separate retention policies.

Migration `o4b9d6f2a087` adds private central conversation storage. Only the owning internal account can list, read, continue or delete a conversation, with `analytics:read` required. Browser callers supply a question and thread/request IDs, never assistant roles, fabricated tool outputs or conversation history. All turns in the bounded conversation are available as context. Idempotent retries avoid duplicate completed generations; leases prevent overlapping turns; provider failures release leases and preserve prior history. Each conversation supports 20 turns before starting another. Per-turn model time, output tokens, tool calls, datasets and concurrency are bounded. Audit records contain model/tool/count/timing metadata, not full prompt text or API keys.

`/api/v1/command/assistant/interpret` remains deprecated for old integrations. The active UI uses `/config`, `/threads` and `/chat`; it does not use the legacy interpreter.

Validation includes 17 conversational-backend tests (ownership, follow-ups, tool execution, scope validation, comparisons, retries, provider errors and tool bounds). The full 110-test backend suite and frontend build pass. Browser checks verify the actual unconfigured state and private history API; connected chat presentation, follow-ups, chart evidence, safe text rendering and mobile layout are tested with explicit browser-only fixtures, never stored as production AI responses. A live provider response has not been verified because no model API key is configured.

## Local run

API:

```powershell
cd backend
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend, in another terminal:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

Background processes, each from `backend`:

```powershell
..\.venv\Scripts\python.exe -m app.command_sync --watch
..\.venv\Scripts\python.exe -m app.command_worker --watch
```

The sync uses 500-record batches and per-portal advisory locks. Its initial historical import can take longer than subsequent incremental passes. Source deletions are not propagated into historical analytics. Use `--full` for timestamp reconciliation; changing canonical mappings also requires reclassifying existing facts or full reconciliation.

## Validation

```powershell
cd backend
..\.venv\Scripts\python.exe -m unittest discover -s tests -q
cd ../frontend
npm.cmd run build
npm.cmd run lint -- src/central src/main.tsx
```

Backend checks cover permissions/revocation, control targeting/idempotency, query bounds/escaping, read-only connections, source scopes, no cross joins, Goyal rollups, timestamps and source clinical access. Browser verification exercises the real login and all 26 tabs in each of three PACS workspaces, portal switching, Back, navigation search, on-prem inventory and mobile without submitting source changes. The copied source's existing lint baseline is distinct from the new central code. Build output retains warnings from the source DICOM decoder's eval-based WebAssembly loader.

Dependency audit: the automatically fixable Vite advisory was updated. Four inherited DICOM dependency findings remain (two high, two low), through `dcmjs` / `dcmjs-imaging` and `adm-zip`, with no upstream fix offered by npm audit. The imported DICOM dependency chain needs review before a production release. No source clinical receivers or Node services are launched by this project.

## Reported study and X-ray accounting

Migration `n3a8c5e1f976` adds central `command_study_usage`. It contains no patient demographics or report content. Each portal/client/study UID has one hashed identity, so processing retries, duplicate bridge agents and multiple report versions do not inflate study usage. Approved/pushed/reported reports and verified report-delivery states establish successful usage for both AI and teleradiology workflows. Available, reporting and unsuccessful attempts remain NOT_PROCESSED, not failed images. Raw job status is retained separately for technical support.

Reported usage is dated by final report approval/delivery; unprocessed inventory is dated by receipt. Reporting turnaround excludes unavailable or invalid timing. Charts, rankings, modality filters and assistant requests all use these business facts. A reported teleradiology study counts as one successful modality endpoint use under the requested business definition, not as a measured HTTP call.

Radiography views (X-Ray and Special X-Ray, retained as separate modalities) use a complete, explicit tariff per-view breakdown first; the source billing line's generic units may represent one whole study and are not used as a view count. Otherwise positive recorded DICOM image count, then processing image count is used. Missing/zero counts remain unknown. CT/MRI image counts, mammography sides and mixed-modality studies are not turned into X-ray views. The view count's source is retained. Source prices, tariffs and credit balances are unchanged.

The mean is total recorded views in reported X-ray studies divided by reported X-ray studies with known views. Unknown studies are disclosed and excluded from the denominator. Additional views are the sum of max(views minus one, zero) for these known studies. Every grouping computes its own weighted average, rather than averaging center averages. The worklist, detail drawer, CSV and paginated `/api/v1/command/analytics/xray-studies` expose per-study views. Analytics provides total views, additional views, average and missing-count coverage. The worklist has a Not processed queue, combining Available and Reporting.

Keyset sync observes changes to bridges, reports, processing image counts and billing view breakdowns, with the existing overlap. The initial study snapshot fills automatically after migration. To reconcile study history after changing business classification rules without replaying the full audit history:

```powershell
cd backend
..\.venv\Scripts\python.exe -m app.command_sync --studies-full
```

The supported-language assistant also accepts `Average X-ray views per study for Marengo last 7 days`. Requests for CT views do not silently become X-ray view analytics.


## Connected DICOM viewer and graphical dashboard

The copied PACS QuickView now has authenticated central adapters for study/report/job/archive viewer sessions, manifests, original DICOM instances, JPEG previews and study export. Every request requires a clinical internal role and resolves its source record in the selected portal, including cached requests. Report-to-job and study-UID lookups retain the client ID. Public sharing is not enabled by this adapter.

Private storage/service credentials are scoped by `PACS_VIEWER_`, `MARENGO_VIEWER_` and `GOYAL_VIEWER_` prefixes in the ignored backend environment file. The existing source configurations have been connected locally. Credentials and source archive paths are never sent in manifests. Local reads resolve real paths inside configured upload roots, including legacy `/uploads/` path remapping. Remote reads use configured S3 buckets and exact recorded keys or study-specific key candidates; there is no arbitrary URL/path proxy and no broad bucket scan.

Small 2D studies use the original browser decoder and viewer tools. CT/MRI use the existing full viewer's documented source import/session protocol. This creates transient viewer imports/sessions; it does not start PACS workers, upload objects, alter source databases, or change reports. Missing acquisition archives return a specific availability message. A full-viewer outage is reported separately from missing storage. A healthy source database alone does not establish image availability.

QuickView limits archives to 256 MiB, 500 images, 2,000 archive entries and bounded decompressed data/image dimensions. A process-local cache retains at most 12 indexes for ten minutes, with private temporary archive files, and always rechecks record access. Viewer sessions, manifests and binary responses use private/no-store headers. Compressed originals are decoded by the original browser codecs; a server preview may be unavailable when a matching Python codec is absent.

Organization and selected-portal dashboards now share a graphical workspace: study activity with zero-filled calendar days, modality share, hourly report completions, portal comparison or study workflow, and portal entry cards. Dates, scope and refresh update real measured facts. Connection details and X-ray billing metrics remain available below the charts. Analytics retains center/client/service/user tables, weighted X-ray metrics, and the per-study view ledger.

Validation: synthetic DICOM/archive tests cover UID isolation, client-scoped resolution, path confinement, manifest/binary/preview/export, private caching and modality routing. Local browser checks rendered a real 3,420 × 4,218 DICOM, exercised viewer tools, and verified charts, portal navigation and mobile layout. A real CT study also opened in the full viewer in Chrome, with five canvases and 28 successful image responses. The 93 backend tests pass. Source clinical data is not committed to this repository.


## Production workflow updates (2026-11-02)

The Marengo source now points to production. When switching a source database, back up that portal's central snapshots and run `python -m app.command_sync --portal marengo --replace-snapshot`. This atomically replaces derived records and checkpoints; `--full` alone does not remove records from the old source. Source databases remain read-only.

Worklists load all cursor pages and display a loading indicator while fetching. Report libraries page through report summaries; report text is fetched on demand. Approved report HTML renders as PDF on the backend. Authenticated study downloads stream connected archives. Seven-day public report/study capabilities are stored hashed in `command_public_shares`, scoped to one portal and target, and can be revoked. Public image requests cannot change their target or access images through report-only links. QR images contain the capability URL. Files absent from both configured uploads and connected S3 cannot be downloaded or viewed until archived to connected storage.

Desktop X-ray licenses in `ai.license_detail` now have separate lifetime balance snapshots. Consumption is inferred from plan allotment minus `credit_left`, with carry-forward/top-up limitations disclosed. Historical balance consumption is not assigned invented study counts or dates. Subsequent observed decreases generate dated credit usage; no-change polls, replenishments and transfers do not create debits. Offline use becomes visible after the application syncs to the source database.

All-time reported study/view totals are displayed separately from date-filtered charts. A completed report's service takes precedence over an unrelated billing service when classifying modality.


## Worklist and report delivery fixes

The worklist now requests `view=worklist&all=1` to load all lightweight study summaries in one compressed response. Three bulk source queries fetch study rows, minimal processing status, and report summaries; report bodies, clinical history and attachments remain on demand. The original cursor API remains available. Records provides server-paged, searchable source studies, reports, processing jobs, job logs, usage, billing, and audit records without a default date cutoff. Clinical access and source-audit permissions still apply.

Nginx must serve `.mjs` PDF worker assets as `application/javascript`, not `application/octet-stream`. The deployed server has a dedicated `.mjs` location with this MIME type and enables gzip for JSON/JavaScript/CSS. Validate report opening by checking that the browser renders a PDF canvas, rather than checking only the PDF response bytes.


## Loading and Lighthouse improvements

Sign-in now loads critical login styles and the session/login UI without the clinical workspace or dashboard modules. Guest loads no longer make a guaranteed-to-fail profile request. Authenticated workspaces load their styles and clinical code on demand; dashboard modules are split from workstation code. Public shared documents and viewers retain their original access paths.

The standard dashboard's trend, modality, hourly and portal charts, plus the desktop credit charts, use lightweight native SVG with readable summaries and hover values. Off-screen charts mount when approaching the viewport. The legacy chart framework is still loaded on demand for modules that need it. Explicit image dimensions, higher-contrast labels, gzip, immutable asset caching, correct JavaScript module MIME types and HTTP/2 are enabled. The private portal intentionally retains `noindex, nofollow`; its SEO score is not increased by exposing administrative pages to search engines. Browser memory-pressure back/forward-cache eviction is not an application cache-header problem.
