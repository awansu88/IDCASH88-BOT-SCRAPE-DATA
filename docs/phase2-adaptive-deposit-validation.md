# Phase 2 adaptive deposit parser validation

Starting commit: `b71eb113aaf749ad88b1531e1dbe674da0310858`. Working branch: `fix/deposit-dom-resilience-v1`. This report belongs to the Phase 2 commit on that branch. Existing PR: https://github.com/awansu88/IDCASH88-BOT-SCRAPE-DATA/pull/23.

## Implementation and trust contract

Both HTMLMapper and RawHttpHtmlParser use `parseDepositDocument` and the shared `resolveDepositColumns` pure resolver. Browser acquisition uses exactly one `page.content()` snapshot; Fast HTTP loads its response once. No per-row browser round trips, fuzzy matching, or header-index/body-index assumptions are used.

Resolution uses exact normalized body data-label identities and approved aliases (including Done/Done? and Username/User Name), plus verified `.player-link`, `.cell-amount`, and canonical bank-number attributes. Evidence must agree; there is no arbitrary precedence between contradictory claims. Registered fallback is allowed only when critical header positions match the verified header signature, no known header/body evidence contradicts the layout, and fallback cells do not claim another identity. Historical unknown noncritical audit/Done labels remain allowed. All four registered layouts are retained unchanged. Unknown shapes require unambiguous semantic identification of all essential fields. Duplicate field ownership, including identical duplicate critical labels, is rejected conservatively.

All 11 RawTransaction fields retain their structure, order, and normalization. Unique trimmed canonical account attributes take priority over visible account formatting; conflicting attributes reject the transaction. Payment ID is neither newly interpreted nor exported. Integer amount rounding remains unchanged for verified formats; malformed numbers, exponent notation, malformed thousands grouping, non-finite values, and invalid calendar process dates now fail closed instead of being partially parsed or used as fingerprint inputs. Verified process-date format is YYYY-MM-DD HH:mm:ss (also accepting the ISO T separator); values are preserved rather than converted. Unsupported future formats require review.

Page classifications distinguish trusted nonempty/empty tables, unknown/conflicting schema, malformed transaction rows, login, permission/error responses, missing table, and browser snapshot failure. Empty placeholders never count as parsed transactions. Nonempty unexpected body rows cannot masquerade as an empty page. Known summary labels are excluded only when no transaction semantic identities are present. Multiple tbody sections are read; multiple matching transaction tables are unsafe.

Parsers may retain valid diagnostic transactions on an unsafe mixed page to preserve the existing parser interface. Such payloads are NOT authorized for ingest: both production acquisition paths gate the whole page before duplicate checking, callbacks, aggregation, or further pagination. PageScanner returns UNSAFE_RESPONSE with navigationFailure=true; login is SESSION_EXPIRED, while snapshot acquisition failure is BROWSER_FAILURE. Fast HTTP retains its strict response classifications and the existing transport policy. Schema/permission/missing-table failures use the established UNSAFE_RESPONSE pause path, not authentication reclassification. No source switching or retry loop was added.

MonitoringEngine continues processing the trusted prior-page aggregate before throwing MonitoringCycleSourceError. PER_PAGE callbacks only receive fully trusted pages. BATCHED prior-page rows remain durable pending work if the cycle aborts. The existing failure policy pauses schema failures, preserves explicit Stop/Start behavior and session recovery, and retains the existing bounded delay ladder for transport/browser errors. Native SQLite tests exercise actual claims, the existing pending export recovery/writer, close/reopen, both export strategies, and retry with exactly one simulated Sheets append. No schema, fingerprint algorithm, dedup policy, filter semantics, source mode, Sheets mapping, or pagination navigation change was made.

Diagnostics contain approved canonical column identities, counts, missing/conflicting field keys, strategy, structural signature, page number and a hashed profile tag. Unknown DOM label strings become UNKNOWN. Rejection details are allowlisted and capped at 20 examples; labels/count variations are bounded. Raw HTML, cell values, canonical account values, and fingerprint input vectors are excluded. Existing transaction/validator logs, browser navigation/filter URL logs, and source-error payload logs were redacted without changing their control flow. No raw credentials or cookie/header values are emitted by the new diagnostic path.

## Acceptance and tests

The original sanitized Phase 1 fixture and Phase 1 regression script are unchanged. Both modes parse 20 transactions, reject zero valid rows, silently skip the 19-cell placeholder, and total 1,628,758 IDR. The Phase 2 suite executes 35 DOM cases with both the test adapter and genuine Chromium, checks exact field parity, all four layouts, extra/reordered/partial labels, unknown layouts, duplicate/conflicting identities, missing critical data, malformed numbers/dates, session/permission/missing-table responses, nested account/amount markup, multiple body sections, and placeholders. Acquisition tests cover later-page failures, no current-page handoff/export/duplicate checks, no incorrect duplicate stop, earlier-page retention, engine pause/stop behavior, and diagnostic redaction.

### Build and explicit commands

| Command | Result |
|---|---|
| `npm run build:main` | PASS, exit 0 |
| `npm run build:renderer` | PASS, exit 0 |
| `npm run test:adaptive-deposit` | PASS, exit 0; 35 DOM cases in adapter and Chromium plus acquisition/engine/redaction checks |
| `npm run test:adaptive-deposit:sqlite` | PASS, exit 0; actual Electron 28 SQLite, BATCHED and PER_PAGE restart/retry safety |
| `npm run test:deposit-dom` | PASS, exit 0; unchanged Phase 1 acceptance |
| `git diff --check` | PASS, exit 0 |
| `npx tsc --noEmit -p tsconfig.renderer.json` | FAIL, exit 2; known baseline TS2322 at MaintenancePage.tsx:320 and :357 |

### Complete package test suite

All 27 non-alias package test scripts passed on the final implementation. Main compilation ran first; underlying commands below ran with `node_modules/.bin` prepended to PATH. The `test:phase0:all` alias only repeats the two already executed phase0 commands and was not separately run.

| Script | Exact executed test command | Result |
|---|---|---|
| `test:phase0` | `node scripts/verify-phase0-baseline.js` | PASS, exit 0 |
| `test:phase0:sqlite` | `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/verify-phase0-sqlite-runtime.js` | PASS, exit 0 |
| `test:phase1:recovery` | `node scripts/verify-phase1-recovery.js` | PASS, exit 0 |
| `test:phase1:sqlite` | `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/verify-phase1-sqlite-recovery.js` | PASS, exit 0 |
| `test:phase2:source` | `node scripts/verify-phase2-source.js` | PASS, exit 0 |
| `test:phase3:filter-resolution` | `node scripts/verify-phase3-filter-resolution.js` | PASS, exit 0 |
| `test:adaptive-deposit:sqlite` | `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/verify-adaptive-deposit-sqlite.js` | PASS, exit 0 |
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

### Other standalone historical verifiers

System Chromium was selected through a temporary preload helper outside the checkout (launch and persistent launch use /usr/bin/chromium; persistent contexts run headless). This changes the test runtime, not production application code or assertions.

| Exact command (from repository root) | Result |
|---|---|
| `node -r /tmp/idcash-phase2/system-chromium.js scripts/verify-iter9-scanning.js` | PASS, exit 0 |
| `node -r /tmp/idcash-phase2/system-chromium.js scripts/verify-unknown-layout-diag.js` | PASS, exit 0; structural diagnostics replace the obsolete raw HTML/value expectations |
| `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron -r /tmp/idcash-phase2/system-chromium.js scripts/verify-iter8-acceptance.js` | PASS, exit 0; 19 assertions. Plain Node initially failed due to SQLite ABI, corrected by using Electron |
| `node -r /tmp/idcash-phase2/system-chromium.js scripts/verify-bug4-html-mapper.js` | FAIL, exit 1; stale missing-user diagnostic assertion. Same 6-pass/1-fail outcome reproduced on Phase 1 |
| `node -r /tmp/idcash-phase2/system-chromium.js scripts/verify-explicit-layout.js` | FAIL, exit 1; expects visible account formatting instead of the Phase 1 canonical attribute. Same failure reproduced on Phase 1 |
| `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/idcash-chromium node -r /tmp/idcash-phase2/system-chromium.js scripts/verify-remaining-issues.js` | FAIL, exit 2; exits at the historical manual-date test after clearing required browser dates. Same exception at script line 222 reproduced on Phase 1. Remaining assertions unrun |

Baseline comparisons used an archived checkout of the exact starting commit under `/tmp/idcash-phase2/phase1-baseline`, with the same dependencies and Chromium helper, without switching/resetting the working checkout. The standalone legacy failures were left visible; they were not disabled or rewritten to pass. The initial remaining-issues attempt could not resolve the app browser; a local system-Chromium symlink and the documented browser-path override allowed the subsequent baseline comparison.

Existing package assertions were adapted only where the authorized contract changes require it: scripted trusted-page results explicitly opt into trust, metadata-aware empty result assertions verify trusted=true, wrong-header Browser results now fail closed like Fast HTTP, a misplaced canonical attribute is a schema conflict, shared-core wiring checks follow the new dependency path, and exact source hashes pin the new implementations rather than removing freeze guards. All existing functional identity/export/durability tests remain active.

## Performance

Command: `node scripts/benchmark-adaptive-deposit-parser.js /tmp/idcash-phase2/phase1-baseline/dist/main/main` — PASS, exit 0. The Phase 1 source was archived and compiled separately with the same dependencies. The benchmark uses the supplied 20-row fixture, silent logging, real system Chromium, seven measured browser parses after warmup and 51 measured Fast HTTP parses after ten warmups.

| Metric | Phase 1 | Phase 2 |
|---|---:|---:|
| Browser median | 676.15 ms | 9.04 ms |
| Browser calls per parse | 364 | 1 |
| Fast HTTP median | 3.24 ms | 3.92 ms |

Fast HTTP parser CPU time increased by about 0.68 ms per 20 rows (21%) for shared semantic/schema validation. Browser DOM acquisition is substantially faster. These local microbenchmarks do not establish production throughput or network latency. Request concurrency, single-worker activity limits, pagination order, and the sole export writer are unchanged.

## Changed files

The Phase 2 change includes the following files (plus this report):

- `README.md`
- `package.json`
- `scripts/benchmark-adaptive-deposit-parser.js`
- `scripts/support/phase5-cheerio-playwright-shim.js`
- `scripts/verify-adaptive-deposit-parser.js`
- `scripts/verify-adaptive-deposit-sqlite.js`
- `scripts/verify-hotfix13c-export-per-page.js`
- `scripts/verify-hotfix13f-nested-account-number.js`
- `scripts/verify-hotfix13h-paused-renderer-state.js`
- `scripts/verify-iter9-scanning.js`
- `scripts/verify-phase0-baseline.js`
- `scripts/verify-phase4-html-parser.js`
- `scripts/verify-phase5-parser-parity.js`
- `scripts/verify-unknown-layout-diag.js`
- `src/main/services/fingerprint-generator.ts`
- `src/main/services/html-mapper.ts`
- `src/main/services/monitoring-engine.ts`
- `src/main/services/page-scanner.ts`
- `src/main/services/playwright-service.ts`
- `src/main/services/transaction-validator.ts`
- `src/main/sources/deposit-column-resolver.ts`
- `src/main/sources/deposit-page-parser.ts`
- `src/main/sources/fast-http-source-adapter.ts`
- `src/main/sources/raw-http-html-parser.ts`

## Remaining limits

The two renderer TS2322 errors and three standalone historical test failures above are known baseline issues. Live authenticated panel access, live Sheets writes, Windows packaging, future alternate date/amount locales, transient panel-loading behavior and unexpected summary labels require independent validation. Unknown semantically incomplete layouts intentionally pause instead of guessing. No live financial data was changed, and no merge, deployment, or Phase 3 work was performed. GitHub API status reads returned Forbidden; publication/PR metadata must not be inferred from local tests or a successful branch push.
