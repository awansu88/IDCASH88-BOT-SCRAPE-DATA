# Phase 2 review fixes: sensitive logging

Reviewed starting commit: `d63b003cc8cafe634ff86e9c4fc46edebf003917`. Branch: `fix/deposit-dom-resilience-v1`. Existing PR: https://github.com/awansu88/IDCASH88-BOT-SCRAPE-DATA/pull/23.

## Fixed paths

- PageScanner: scan-start profile identifiers are hashed; TABLE DIAGNOSTIC has only a profile tag, URL availability, numeric URL/DOM/current page markers and row counts. The raw Current URL table line was already absent in the reviewed commit. The original URL remains untouched in navigation and verification. The table-wait timeout no longer logs the original exception; benign end-of-pagination diagnostics no longer interpolate arbitrary exception messages.
- MonitoringEngine: profile names in summaries, rejection diagnostics, worker errors, availability notices and pause/retry context are hashed. Resume-marker values are replaced with presence/status metadata. Session/config errors no longer render arbitrary reasons or parse-error messages. Diagnostic codes/modes are allowlisted and counts validated; original values still drive policy, filtering, ingest and durable state.
- MonitoringCycleSourceError: the human-readable message uses a hashed profile tag and safe code. Its internal filterName and terminationReason properties are preserved for existing routing and recovery contracts. Only a newly constructed safe Error reaches affected engine log calls, never the original stack, cause, properties, message or name.
- PlaywrightService: filter, agent, requested/canonical payment and profile-availability identifiers are hashed. Date-control diagnostics report presence instead of arbitrary DOM text. Browser-resolution paths are tagged rather than printed. Payment/date error messages omit embedded exception text or untrusted readback values; original selection/fill/verification decisions and exception flags are unchanged.
- FilterManager: profile create/update/delete logs and not-found messages use hashed identifiers, preserving stored names/IDs and mutation behavior.
- ConfigManager: app/filter/Sheets configuration load failures use safe errors, preventing malformed JSON snippets and filesystem exception properties from entering logs; all fallback return values remain unchanged.
- Shared safe-diagnostics helper: retains the existing 12-character SHA-256 profile-tag algorithm, validates diagnostic codes/counts, and creates clean error records. depositDiagnostics reuses it solely for profile hashing. The pure parser body, resolver, layouts and other protected implementations remain byte-for-byte unchanged.

## Regression evidence

`scripts/verify-sensitive-logging.js` uses synthetic _token, csrf_token, session_id, username/account path identifiers, filter names/IDs, agent/payment values, and poisoned Error name/code/message/cause/properties. It captures every logger argument including Error details with deep inspection and asserts that no sentinel, sensitive query parameter or user-specific transaction path appears. It also asserts that safe table/pagination metadata, reason codes and expected profile tags remain present, preventing a silent/no-op logger from satisfying the test.

Real Chromium traverses page 1 to page 2 under the original token-bearing path/query for successful pagination, schema mismatch, missing table and session expiry. Tests assert unchanged internal URL/token continuity and scan outcomes. Additional cases cover the table timeout and benign navigation exception, Browser/Fast HTTP logging, engine validation/summary/worker/config/pause/retry paths, profile CRUD, actual malformed configuration reads, payment selection/disappearance and date readback errors. Raw filter values still reach browser controls and central ingest. The test compares the reviewed pure parser body, resolver/layout registry, fingerprint generator, ingest, schema/SQLite, Sheets export, pending recovery, HTTP parser/adapter and failure-decision policy against the starting commit.

## Validation results

| Command | Result |
|---|---|
| `npm run build` | PASS, exit 0; both requested repetitions plus a final build after the last logging changes |
| `npm run test` | FAIL, exit 1, both requested repetitions: Missing script: test. The reviewed package.json also has no test script; no alias was added to conceal this |
| `npm run test:adaptive-deposit` | PASS, exit 0; 35 DOM cases with real Chromium plus page-boundary/durability/redaction checks |
| `npm run test:logging-redaction` | PASS, exit 0; new synthetic logging regression |
| `node scripts/verify-sensitive-logging.js` | PASS, exit 0; final strengthened metadata assertions |
| `git diff --check` | PASS, exit 0 |
| `npx tsc --noEmit -p tsconfig.renderer.json` | FAIL, exit 2; existing TS2322 at MaintenancePage.tsx:320 and :357 only |

All 28 named non-alias package test scripts passed after the final production edits. The build ran first; the exact underlying commands below ran with node_modules/.bin prepended to PATH. test:phase0:all only repeats the two phase0 checks and was not separately invoked. Individual exit statuses were recorded; no assertions were disabled and no failures are described as passes.

| Package script | Exact executed test command | Result |
|---|---|---|
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

Existing exact-source freeze assertions were repinned for the authorized logging changes; the failure-decision body is also compared directly to the reviewed commit in the new regression. No functional assertions were removed.

## Baseline issues and remaining limits

The renderer typecheck failure is separate from the passing main/Vite builds and package tests. The previously documented standalone failures in verify-bug4-html-mapper.js (stale missing-user diagnostic assertion), verify-explicit-layout.js (stale visible-account expectation), and verify-remaining-issues.js (historical manual-date exception) were reproduced against Phase 1 during Phase 2. Those standalone verifiers were not rerun for this logging-only pass, and their failures are not counted as passes. See phase2-adaptive-deposit-validation.md for prior commands and evidence.

No live panel credentials, real transaction data, or live Sheets writes were used. Testing covers the affected acquisition, parser, filter/configuration and monitoring logging paths; it does not establish a global audit of every unrelated UI/dependency log. Deterministic profile tags retain correlation without logging raw identifiers. No merge, deployment, dependency installation, or Phase 3 work was performed.
