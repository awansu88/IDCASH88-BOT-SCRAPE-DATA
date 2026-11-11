# Phase 3 Windows release-readiness evidence

Starting commit: `f82e3fc13dcc10b807abc87c0e0c8475032ac3c9`. Branch: `fix/deposit-dom-resilience-v1`. PR: https://github.com/awansu88/IDCASH88-BOT-SCRAPE-DATA/pull/23. The commit containing this report is the Phase 3 handoff; record its full SHA before building on Windows.

## Audit and runtime requirements

`git merge-base --is-ancestor` returned 0 for each prior commit: Phase 1 `b71eb113aaf749ad88b1531e1dbe674da0310858`, Phase 2 `d63b003cc8cafe634ff86e9c4fc46edebf003917`, and review fixes `f82e3fc13dcc10b807abc87c0e0c8475032ac3c9`. The checkout was initially clean.

The lockfile installs Electron 28.3.3, Playwright 1.42.0, and better-sqlite3 9.6.0. Build tooling @electron/rebuild requires Node >=22.12; Windows instructions choose Node 22 LTS and a staged locked install, then rebuild native dependencies for Electron. The packaged app itself requires neither Node nor system Chrome. It uses Electron Chromium for the UI and a separate bundled Playwright Windows Chromium for scraping.

Electron main is dist/main/main/index.js, preload dist/main/main/preload.js, and renderer dist/renderer/index.html. Native SQLite files are unpacked from ASAR. Browser resources are extraResources at resources/browsers/chromium-<revision>/chrome-win/chrome.exe with DLL/pak/data companions. Browser resolution is bundled resources first, PLAYWRIGHT_BROWSERS_PATH next, then the platform Playwright cache. Missing discovery produces the existing friendly error contract; native Windows dialog behavior remains a Windows gate.

Portable business state is next to the original executable in LiveDepositMonitor-Data; installed state uses Electron userData. Config, database/monitoring.db, logs, logs/screenshots, browser-profile and credentials are separate directories. Portable folders must be writable. Electron global cache/single-instance isolation is not guaranteed merely by copying the executable, so the packaged startup runbook calls for Sandbox/VM or a separate Windows account. Never copy production credentials or databases into the smoke-test instance.

Existing production MonitoringEngine initialization/ingest/recovery, SQLite V1 and Sheets mapping were inspected and retained. Monitoring can durably claim rows and drain existing pending exports; disconnecting Sheets is not a dry-run. Existing schema/session failures pause and Stop is cooperative. AUTO chooses once from existing readiness and does not retry/switch on schema errors. The readonly harness intentionally disables duplicate-page stopping without loading any production dedup state. Existing production duplicate behavior is still tested.

## Confirmed changes

- Removed the explicit nonexistent assets/icon.ico reference, allowing the Electron default icon. No custom brand icon was invented.
- Excluded resources/browsers from ASAR files while retaining extraResources, avoiding duplicate browser copies.
- Portable summary accepts only the configured LiveDepositMonitor-Portable.exe; a Setup.exe no longer counts as a portable artifact. It checks required nonempty Chromium runtime files in the packaged copy as well as the prepack source verification. Synthetic negative fixtures reproduce both failures; they are never installed or published as binaries.
- Added a standalone opt-in read-only CLI and source-adapter controller, conservative same-origin route/API guards, bounded one-to-three-page scans and safe summary reporting. No production UI or monitoring default changed. Playwright launch accepts optional headless/service-worker options for isolated tests/validation; production defaults remain headed and unchanged. Logger shutdown is explicit only for short-lived validation cleanup.
- Added npm test, renderer typecheck and release/read-only/historical test entrypoints. All child test exits contribute to the overall failure status; no assertions are disabled. Browser tests use CHROMIUM_PATH or the pinned Playwright executable rather than a Linux-only hardcoded default.
- ConfirmDialog.description now correctly accepts ReactNode, matching its existing JSX rendering; this resolves both TS2322 errors without changing render/control behavior.
- Historical assertions now use missingFields and canonical account values; all four supported layouts are exercised and unsupported offset-guessing layouts must fail closed. The remaining-issues fixture uses a native submit listener instead of external jQuery, repository-relative paths, and current fingerprint-only/initial-sync contracts. Historical screenshot-derived identifiers were replaced with synthetic values.

## Read-only safety and test coverage

The CLI requires --read-only, an authorized query-free deposit URL and a separate minimal profile JSON file (name/agent/depositType). It does not import or construct MonitoringEngine, SQLite, fingerprint/dedup services, export queues or a Google client. It never reads the production configuration or browser profile. Profile files are unchanged; UTF-8 BOM is supported. A fresh temporary browser profile/log directory is cleaned after use, and reports are created exclusively without overwriting an existing file.

Browser routing allows only the same-origin known deposit endpoint, normal authentication routes and static assets; unsupported methods/routes/parameters and cross-origin destinations are blocked. Manual authentication and read/filter form POSTs are allowed and can change remote session state; this is not a promise of zero HTTP POSTs. WebSockets and service workers are blocked. Fast API requests are independently guarded and automatic redirects disabled (browser route interception alone does not protect APIRequestContext). Unknown panel SSO/CDN/autocomplete contracts require a separate reviewed adjustment, not disabling guards.

The same shared parser is used for preflight and the production source adapters. A missing/login/partial/unsafe initial page fails before filter acquisition. Later unsafe pages exclude all their rows and stop. Safe summary data includes counts, integer nominal totals, recognized timestamp ranges, classification/signature/codes, source selection and hashed profile identity. Unrecognized timestamp text is counted, not printed. Reports always state sheetsWrites=0, databaseOpened=false, exportStatus=NOT_ATTEMPTED and resumeMarkerAdvanced=false.

18 real Chromium/controller cases cover LEGACY/FAST/AUTO × nonempty, later schema mismatch, missing table, partial loading, session expiry and empty valid table. Other tests cover max-page limits, cooperative stop, guarded API redirects, blocked transaction mutation requests that never reach the local server, input preservation and module-load exclusion of write-capable services. An actual CLI child reads a BOM profile, handles the prompt against a local synthetic panel, writes a 20-row / 1,628,758-unit summary, preserves its profile file and removes its temporary session. Test-only preload selects installed Linux Chromium/headless mode; production validation code/guards are not mocked.

Existing suites cover all four layouts, nested markup, placeholder rows, duplicate-page stop, no unvalidated handoff, concurrent source bounds, native SQLite V1 compatibility, close/reopen/recovery and no duplicate simulated export on retry. All databases and remote writer stubs used by these tests are isolated/synthetic. No live panel or Sheets operation was performed.

## Exact command results

| Command | Result |
|---|---|
| `npm test` | PASS, exit 0; final full build/typecheck plus 31 named suites |
| `npm run build` | PASS, exit 0; main and renderer, also executed by npm test |
| `npm run typecheck:renderer` | PASS, exit 0; prior TS2322 baseline resolved |
| `npm run test:deposit-dom` | PASS, exit 0; explicit acceptance command |
| `npm run test:adaptive-deposit` | PASS, exit 0; explicit acceptance command |
| `npm run test:adaptive-deposit:sqlite` | PASS, exit 0; explicit native acceptance command |
| `npm run test:logging-redaction` | PASS, exit 0; explicit acceptance command |
| `CHROMIUM_PATH=/usr/bin/chromium ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/verify-historical.js` | PASS, exit 0; all six historical verifiers |
| `CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-read-only-validation.js` | PASS, exit 0; source/controller/actual CLI integration |
| `node scripts/verify-release-readiness.js` | PASS, exit 0; isolated path/config/discovery/resource contracts and actual Linux Electron 28 SQLite ABI |
| `node scripts/validate-read-only.js --help` | PASS, exit 0; no browser/state initialization |
| `git diff --check` | PASS, exit 0 |
| `npm run dist:portable` | FAIL, exit 1 at bundle:browser: no Windows-x64 chrome-win/chrome.exe cache. Cross-build did not reach electron-builder or produce an executable |
| Actual Linux `electron . --no-sandbox` with a disposable PORTABLE_EXECUTABLE_DIR | BLOCKED, exit 1: no X server/$DISPLAY, plus readonly/default Chromium cache and D-Bus warnings. No GUI startup pass claimed |
| Native Windows packaging / executable execution / Windows SQLite ABI | NOT TESTED — current executor is Linux |

Explicit browser acceptance commands used CHROMIUM_PATH=/usr/bin/chromium. npm test automatically selects that installed browser on Linux only; Windows selects the installed pinned Playwright browser unless CHROMIUM_PATH is supplied. Native SQLite and historical suites run under Electron as required by the native ABI. The test:phase0:all alias repeats the two already executed checks and was not separately invoked.

### Named suites executed by npm test

| Suite | Underlying command after the common build | Result |
|---|---|---|
| `test:release-readiness` | `node scripts/verify-release-readiness.js` | PASS, exit 0 |
| `test:read-only` | `node scripts/verify-read-only-validation.js` | PASS, exit 0 |
| `test:historical` | `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/verify-historical.js` | PASS, exit 0 |
| `test:phase0` | `node scripts/verify-phase0-baseline.js` | PASS, exit 0 |
| `test:phase0:sqlite` | `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/verify-phase0-sqlite-runtime.js` | PASS, exit 0 |
| `test:phase1:recovery` | `node scripts/verify-phase1-recovery.js` | PASS, exit 0 |
| `test:phase1:sqlite` | `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/verify-phase1-sqlite-recovery.js` | PASS, exit 0 |
| `test:phase2:source` | `node scripts/verify-phase2-source.js` | PASS, exit 0 |
| `test:phase3:filter-resolution` | `node scripts/verify-phase3-filter-resolution.js` | PASS, exit 0 |
| `test:adaptive-deposit:sqlite` | `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/verify-adaptive-deposit-sqlite.js` | PASS, exit 0 |
| `test:logging-redaction` | `node scripts/verify-sensitive-logging.js` | PASS, exit 0 |
| `test:adaptive-deposit` | `node scripts/verify-adaptive-deposit-parser.js` | PASS, exit 0 |
| `test:deposit-dom` | `node scripts/verify-deposit-dom-resilience.js` | PASS, exit 0 |
| `test:phase4:html-parser` | `node scripts/verify-phase4-html-parser.js` | PASS, exit 0 |
| `test:phase5:parser-parity` | `node scripts/verify-phase5-parser-parity.js` | PASS, exit 0 |
| `test:phase6:fast-http` | `node scripts/verify-phase6-fast-http-worker.js` | PASS, exit 0 |
| `test:phase7:ingest` | `node scripts/verify-phase7-central-ingest.js` | PASS, exit 0 |
| `test:phase7:sqlite` | `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/verify-phase7-sqlite-atomic-ingest.js` | PASS, exit 0 |
| `test:phase8:export-writer` | `node scripts/verify-phase8-export-writer-queue.js` | PASS, exit 0 |
| `test:phase9:fast-concurrency` | `node scripts/verify-phase9-fast-concurrency.js` | PASS, exit 0 |
| `test:phase10:source-mode` | `node scripts/verify-phase10-source-mode.js` | PASS, exit 0 |
| `test:phase11:performance` | `node scripts/verify-phase11-performance.js` | PASS, exit 0 |
| `test:phase12:hardening` | `node scripts/verify-phase12-production-hardening.js` | PASS, exit 0 |
| `test:hotfix13a:legacy-payment` | `node scripts/verify-hotfix13a-legacy-payment-canonicalization.js` | PASS, exit 0 |
| `test:hotfix13b:fast-get-projection` | `node scripts/verify-hotfix13b-fast-safe-get-projection.js` | PASS, exit 0 |
| `test:hotfix13c:export-per-page` | `node scripts/verify-hotfix13c-export-per-page.js` | PASS, exit 0 |
| `test:hotfix13d:live-post-pagination` | `node scripts/verify-hotfix13d-live-post-pagination.js` | PASS, exit 0 |
| `test:hotfix13e:navigation-header-parity` | `node scripts/verify-hotfix13e-navigation-header-parity.js` | PASS, exit 0 |
| `test:hotfix13f:nested-account-number` | `node scripts/verify-hotfix13f-nested-account-number.js` | PASS, exit 0 |
| `test:hotfix13g:runtime-session-pause` | `node scripts/verify-hotfix13g-runtime-session-pause.js` | PASS, exit 0 |
| `test:hotfix13h:paused-renderer-state` | `node scripts/verify-hotfix13h-paused-renderer-state.js` | PASS, exit 0 |

## Baseline cleanup classification

| Previous issue | Classification | Outcome |
|---|---|---|
| MaintenancePage TS2322 at 320/357 | Actual type annotation defect in ConfirmDialog.description | Resolved; renderer typecheck PASS |
| verify-bug4-html-mapper.js | Outdated raw diagnostic assertion | Resolved with exact missing-field/PII exclusion checks; PASS |
| verify-explicit-layout.js | Outdated visible-account expectation | Resolved with canonical account assertion and synthetic identifiers; PASS |
| verify-remaining-issues.js | Outdated heuristic/source-path expectations and non-hermetic browser fixture | Resolved without changing production filters; 13 checks PASS |
| Missing npm test | Missing test entrypoint | Resolved; complete entrypoint PASS |
| Existing tray Pause/Resume menu placeholders | Non-blocking technical debt for this controlled workflow | Not changed; use dashboard Stop/Start and tray Exit |

Historical additionally: verify-iter8-acceptance.js PASS (19 assertions), verify-iter9-scanning.js PASS (23 assertions), verify-unknown-layout-diag.js PASS. Prior Phase 1/2 reports remain historical records; this does not retroactively describe failed runs as passing. Initial development runs caught a Node/Electron signal-listener typing mismatch and missing-table handling before acquisition; both were corrected and the final full suite reran successfully.

## Windows artifact and release gates

No Windows executable was produced or uploaded. Synthetic files in unit tests are negative fixtures, not cross-build artifacts and not execution evidence. The production bundler retains its Windows PE/runtime verification; nothing was renamed or fabricated to bypass it. Required Windows browser resources are absent here, and no Wine/native Windows build or execution was established. Actual packaged ASAR contents, Windows native addon loading, Chromium launch, permissions, Defender, tray/Exit/single-instance behavior and clean-machine self-containment still need native Windows evidence.

Manual login, actual panel endpoints/assets, filters/dates, pagination, partial-loading behavior, session expiry, nominal currency/timestamp reconciliation and absence of unintended admin-panel mutations remain gated live checks after independent review. The conservative harness may block unrecognized legitimate panel dependencies; this must be reviewed, never silently bypassed. The runbook provides separate CMD/PowerShell steps, clean-account/Sandbox startup, safe evidence collection, cancellation and closed-state rollback. No production settings, credentials, existing database, fingerprint/dedup/Sheets contract or source-mode default was modified.

## Files changed


- `BUILD.md`
- `README.md`
- `docs/phase3-windows-live-validation.md`
- `package.json`
- `scripts/benchmark-adaptive-deposit-parser.js`
- `scripts/portable-build-summary.js`
- `scripts/run-tests.js`
- `scripts/support/test-browser.js`
- `scripts/validate-read-only.js`
- `scripts/verify-adaptive-deposit-parser.js`
- `scripts/verify-bug4-html-mapper.js`
- `scripts/verify-deposit-dom-resilience.js`
- `scripts/verify-explicit-layout.js`
- `scripts/verify-historical.js`
- `scripts/verify-iter8-acceptance.js`
- `scripts/verify-iter9-scanning.js`
- `scripts/verify-read-only-validation.js`
- `scripts/verify-release-readiness.js`
- `scripts/verify-remaining-issues.js`
- `scripts/verify-sensitive-logging.js`
- `scripts/verify-unknown-layout-diag.js`
- `src/main/services/logger-service.ts`
- `src/main/services/playwright-service.ts`
- `src/main/validation/read-only-cli.ts`
- `src/main/validation/read-only-validation.ts`
- `src/renderer/components/ConfirmDialog.tsx`
- `docs/phase3-release-readiness-evidence.md` (this report)

Phase 3 is ready for code/runbook review, with the Windows/live gates above still outstanding. No merge, deployment, live exports or next-phase implementation was performed.
