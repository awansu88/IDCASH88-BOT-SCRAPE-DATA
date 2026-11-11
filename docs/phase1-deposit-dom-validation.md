# Phase 1 deposit DOM compatibility validation

Base commit: `7e612410e62bb647b4e805213384a9c1995a91a1`.
Branch: `fix/deposit-dom-resilience-v1`.

## Acceptance

The attached sanitized fixture is preserved unchanged as `scripts/fixtures/deposit-dom/layout-18h-16b.html`. It has 18 headers, 20 transaction rows with 16 cells each, and one empty placeholder with 19 cells. Both HTMLMapper (including actual headless Chromium) and Fast HTTP parse exactly 20 transactions, reject zero rows, silently skip the placeholder, and extract amounts totaling **1,628,758 IDR**. All 11 RawTransaction fields agree exactly, with expectations independently read from semantic DOM labels. Nested amount highlights, canonical account preference, duplicate canonical values, conflicting attributes, visible-text fallback, all three old layouts, and unknown-layout rejection are covered.

Destination is body index 5; PAYMENT_ID retains positional index 6 only and is neither exported nor interpreted as a verified transaction ID. Payment Type is omitted; currency through deposit type use indexes 7–12, agent 13, process date 14, created at 15.

## Commands and results

`npm run build` — PASS (TypeScript main build and Vite renderer build).

`npx tsc --noEmit -p tsconfig.renderer.json` — FAIL (exit 2): pre-existing TS2322 errors in `src/renderer/pages/MaintenancePage.tsx` at lines 320 and 357 (`Element` is not assignable to `string`). Reproduced against an archive of the untouched base commit with `node_modules/.bin/tsc --noEmit -p /tmp/idcash-phase1-baseline/tsconfig.renderer.json` — same two errors, exit 2. The UI is outside Phase 1 and was left unchanged.

`npm run test:deposit-dom` — PASS (includes main build and real Chromium regression).

The complete package test suite ran after the build using the commands below, with `node_modules/.bin` added to PATH for repository executables. Every command exited 0. The `test:phase0:all` alias repeats the two phase0 tests and was not separately invoked.

| Package script | Exact test command | Result |
|---|---|---|
| `test:phase0` | `node scripts/verify-phase0-baseline.js` | PASS |
| `test:phase0:sqlite` | `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/verify-phase0-sqlite-runtime.js` | PASS |
| `test:phase1:recovery` | `node scripts/verify-phase1-recovery.js` | PASS |
| `test:phase1:sqlite` | `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/verify-phase1-sqlite-recovery.js` | PASS |
| `test:phase2:source` | `node scripts/verify-phase2-source.js` | PASS |
| `test:phase3:filter-resolution` | `node scripts/verify-phase3-filter-resolution.js` | PASS |
| `test:deposit-dom` | `node scripts/verify-deposit-dom-resilience.js` | PASS |
| `test:phase4:html-parser` | `node scripts/verify-phase4-html-parser.js` | PASS |
| `test:phase5:parser-parity` | `node scripts/verify-phase5-parser-parity.js` | PASS |
| `test:phase6:fast-http` | `node scripts/verify-phase6-fast-http-worker.js` | PASS |
| `test:phase7:ingest` | `node scripts/verify-phase7-central-ingest.js` | PASS |
| `test:phase7:sqlite` | `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/verify-phase7-sqlite-atomic-ingest.js` | PASS |
| `test:phase8:export-writer` | `node scripts/verify-phase8-export-writer-queue.js` | PASS |
| `test:phase9:fast-concurrency` | `node scripts/verify-phase9-fast-concurrency.js` | PASS |
| `test:phase10:source-mode` | `node scripts/verify-phase10-source-mode.js` | PASS |
| `test:phase11:performance` | `node scripts/verify-phase11-performance.js` | PASS |
| `test:phase12:hardening` | `node scripts/verify-phase12-production-hardening.js` | PASS |
| `test:hotfix13a:legacy-payment` | `node scripts/verify-hotfix13a-legacy-payment-canonicalization.js` | PASS |
| `test:hotfix13b:fast-get-projection` | `node scripts/verify-hotfix13b-fast-safe-get-projection.js` | PASS |
| `test:hotfix13c:export-per-page` | `node scripts/verify-hotfix13c-export-per-page.js` | PASS |
| `test:hotfix13d:live-post-pagination` | `node scripts/verify-hotfix13d-live-post-pagination.js` | PASS |
| `test:hotfix13e:navigation-header-parity` | `node scripts/verify-hotfix13e-navigation-header-parity.js` | PASS |
| `test:hotfix13f:nested-account-number` | `node scripts/verify-hotfix13f-nested-account-number.js` | PASS |
| `test:hotfix13g:runtime-session-pause` | `node scripts/verify-hotfix13g-runtime-session-pause.js` | PASS |
| `test:hotfix13h:paused-renderer-state` | `node scripts/verify-hotfix13h-paused-renderer-state.js` | PASS |

Initial checks found outdated layout-list/source-freeze expectations; they were updated for this authorized parser change, while retaining hashes for unchanged Fast HTTP and fingerprint code and all other backend restrictions. An initial custom suite launcher omitted node_modules/.bin from PATH and could not invoke cross-env for SQLite; those checks passed through npm and in the corrected complete launcher.

## Scope and limits

No fingerprint, deduplication, filter, pagination navigation, schema, Sheets mapping, source mode, or UI implementation changed. Empty-row skipping and nonempty duplicate-page termination guards already existed and remain unchanged. Fast HTTP implementation already handled canonical attributes; the shared registry enables the new layout there. Validation uses offline sanitized HTML and local SQLite; no live panel, Sheets access, deployment, or Windows packaging was performed. Chromium regression defaults to `/usr/bin/chromium`; override `CHROMIUM_PATH` on other machines.
