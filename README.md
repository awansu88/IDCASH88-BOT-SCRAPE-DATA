# Live Deposit Monitoring System

A production-ready Windows desktop application for continuously monitoring deposit transactions from a web panel and exporting them to Google Sheets.

## 🎯 Overview

**Read-only monitoring system** designed for 24/7 continuous operation with:
- Stability, reliability, and low resource usage
- Configurable filter profiles with priority-based execution
- Google Sheets batch export with retry logic
- SQLite-based transaction fingerprinting for deduplication
- Persistent browser sessions with manual login

## 🏗️ Architecture

- **Electron** desktop application (Windows)
- **React 18** + **TypeScript** frontend
- **Playwright** browser automation
- **SQLite** (better-sqlite3) local database
- **Google Sheets API v4** for export
- **Zustand** state management
- **Winston** structured logging

## 📦 Installation

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build for production
npm run build

# Create Windows installer + portable version
npm run dist
```

## 🎬 Output

The `npm run dist` command generates:
- `dist-build/Live Deposit Monitor Setup 1.0.0.exe` - Windows installer
- `dist-build/LiveDepositMonitor-Portable.exe` - Portable version

## 📋 Features

### Core Monitoring
- Priority-based filter execution (first-match-wins)
- Adaptive pagination (stops on already-processed transactions)
- SHA-1 fingerprint generation (User ID + Account + Amount + Process Date)
- Two-stage duplicate detection (SQLite + in-memory buffer)
- Auto-recovery after application restart

### Google Sheets Integration
- Fixed worksheet name: `MASTER`
- Auto-initialize headers if empty
- Column B: USER ID, C: AMOUNT, D: SHEET DATA (short fingerprint), E: TIME STAMP
- Batch export (up to 1000 transactions per batch)
- Automatic retry on failure

### UI Features
- Dark mode dashboard (operator-friendly)
- Real-time export statistics
- Connection status indicators
- Pre-run validation (8 checks)
- System tray integration (minimize to tray)
- Toast notifications + modal dialogs

### Transaction Processing Pipeline

The browser is the **single source of truth** for business filtering. Every row
visible in the deposit table has already passed every configured browser filter
(Status, Done, Deposit Type, Agent, Include/Exclude Keywords), so the backend
does **not** re-evaluate those decisions.

```
Apply Browser Filter          (every cycle starts from Page 1)
       ↓
Wait Search Complete
       ↓
Read Current Page  →  Parse HTML  (HTMLMapper — pure parser)
       ↓
Essential Field Check  (User Name, Account Number, Amount, Process Date)
       ↓
Generate Fingerprint
       ↓
Duplicate Detection  (SQLite cache + in-memory buffer)
       ↓
SQLite  (write-ahead as 'pending')
       ↓
Google Sheets  (batch append at B{firstEmpty}:E{firstEmpty+n-1})
       ↓
Mark Exported
       ↓
Resume Marker Advance  (SQLite `app_state('resume_marker')`)
       ↓
Next Page  (stop only when the current page is 100% duplicates)
```

The **only** scan-termination condition is: the current page contains at
least one parsed transaction, and every one of them is already known to
SQLite (or the in-cycle cache). No Process Date compare, no Resume Marker
compare, no Created Time compare. See "Scanning" below.

### Scanning

Every polling cycle begins with a fresh browser Search and always starts
from Page 1. The panel is ordered by **Created At** — new transactions
always appear on Page 1 of a new snapshot.

For each page the scanner:
1. Parses rows with `HTMLMapper` (pure parser + Production Layout Registry).
2. Runs the caller-supplied duplicate predicate (`fingerprint + SQLite`)
   against every row **for the stop decision only**.
3. Returns every parsed row (new AND duplicate) to `MonitoringEngine`,
   which then runs the full pipeline (Essential Field Check → fingerprint
   → dedup → buffer) exactly once per row.
4. If every row on the page was a duplicate → stop scanning. Otherwise
   click Next.

Resume Marker is **not** a scan stop signal. It exists only for:
- Startup recovery (loaded at initialize, cross-checked with Sheets col D).
- Crash recovery (persisted after every successful export).
- Dashboard / operational logging.

### Google Sheets Contract

Only **physical column letters** are part of the contract. Header labels may
be renamed at any time without affecting export or resume behaviour.

| Column | Purpose                             | Written by app | Source field |
|--------|-------------------------------------|:--------------:|--------------|
| A      | `NO.` (ArrayFormula)                | No             | —            |
| B      | USER ID                             | **Yes**        | `userName`   |
| C      | AMOUNT                              | **Yes**        | `amount`     |
| D      | KEY_ID (short fingerprint — Resume Marker source) | **Yes** | first 8 chars of `transactionFingerprint` |
| E      | TIME STAMP                          | **Yes**        | `createdAt` (falls back to `processDate` for pre-iter-9 retry rows) |
| F      | TRUE AMOUNT (ArrayFormula)          | No             | —            |
| G, H   | Reserved                            | No             | —            |
| I      | TX_ID (ArrayFormula)                | No             | —            |

`createdAt` is written into Column E so operators can reconcile the Sheets
row order directly with the deposit panel (which is sorted by Created At).
Fingerprint inputs are unchanged (`userName + accountNumber + amount +
processDate`) — the algorithm remains backward compatible.

- Insertion row is computed by scanning **Column B only** starting at B2 and
  finding the first empty cell (`getLastRow()` / worksheet metadata are
  ignored so ArrayFormula spillover in A/F/I never affects placement).
- Writes use `values.update` with an explicit `B{start}:E{end}` range so the
  ArrayFormula cells are physically untouched.

### Resume After Restart

- After every **successful** Google Sheets export + Mark-Exported step, the
  short KEY_ID (8-char upper-case fingerprint) of the newest exported row is
  persisted into SQLite `app_state('resume_marker')`.
- On `startMonitoring()`, the SQLite marker is cross-checked against
  Google Sheets column D. **Google Sheets wins** on disagreement (SQLite is
  a fast local cache; Sheets is the production source of truth).
- The Resume Marker is **never** used to stop scanning — it exists purely
  for recovery, dashboard, and diagnostics.
- The marker is **never** advanced on Sheets failure — a crash mid-write
  leaves the row `pending` in SQLite and the retry queue re-attempts on
  the next cycle.

### Essential Field Check
Required for a row to proceed past the parser:
- User Name
- Account Number
- Amount (numeric)
- Process Date

Any other fields (Bank, Account Name, Status, Done, Deposit Type, Payment
Type, Agent) are captured when present but are **not** re-validated —
those decisions belong to the browser filter.

### Production HTML Assumptions

Browser and Fast HTTP acquisition share one pure deposit parser. The browser
reads one consistent HTML snapshot; both modes then resolve body-cell identities
from exact normalized `data-label` values and verified semantic classes or
attributes. Known aliases include `Done`/`Done?` and `User Name`/`Username`.
Header indexes are never assumed to equal body indexes.

Unlabeled cells may use the shared layout registry only after critical header
identities and body evidence validate that layout. A matching cell count cannot
override contradictory semantic evidence. Unknown layouts require unambiguous
semantic identification of every essential field. Duplicate field ownership and
conflicting canonical account-number attributes fail closed.

| Layout | Header count | Body count | Notes |
|---|---|---|---|
| Modern production row | 17 | 15 | Payment Type and trailing audit cell omitted. |
| Legacy full row | 16 | 16 | All body columns emitted. |
| Legacy short row | 16 | 15 | Payment Type omitted. |
| Destination row | 18 | 16 | Destination at body index 5; Payment Type omitted. |

Whitespace-only placeholders are silently skipped regardless of their cell
count. A schema mismatch or malformed transaction makes the whole current page
unsafe: it is excluded from ingest/export, duplicate-page decisions, and further
pagination. Trusted prior pages retain the existing durable processing contract.
Schema failures pause monitoring through `UNSAFE_RESPONSE`; they are not login
failures. Missing tables and snapshot failures are never treated as valid empty
results. Empty results require recognizable table structure.

Diagnostics contain structural counts, canonical labels, error codes, missing or
conflicting field identities, resolver strategy and layout signature. They do
not include raw transaction HTML, account values, usernames, or sensitive URLs.
Future aliases and layout changes should be backed by sanitized fixtures and
parser/acquisition regressions. See [Phase 2 validation](docs/phase2-adaptive-deposit-validation.md)
for the trust contract, exact test results, performance comparison, and known
baseline failures.

## 🗂️ Application Data

### Installed Mode
```
%APPDATA%/Live Deposit Monitor/
├── config/
│   ├── app.config.json
│   ├── filter-profiles.json
│   └── google-sheets.json
├── credentials/
│   └── google-service-account.json
├── database/
│   └── monitoring.db
├── logs/
│   ├── app-YYYY-MM-DD.log
│   └── screenshots/
└── browser-profile/
```

### Portable Mode
Same structure inside `LiveDepositMonitor-Data/` next to the executable.

## 🔐 Google Sheets Setup

1. Create a Google Cloud project
2. Enable Google Sheets API
3. Create a service account
4. Download the service account JSON key
5. Share your spreadsheet with the service account email
6. Ensure worksheet named "MASTER" exists (or leave empty for auto-init)

## 🛠️ Development

### Project Structure
```
src/
├── main/                    # Electron main process
│   ├── index.ts
│   ├── ipc-handlers.ts
│   ├── window-manager.ts
│   ├── tray-manager.ts
│   ├── preload.ts
│   └── services/            # Business logic services
├── renderer/                # React UI
│   ├── App.tsx
│   ├── pages/               # 6 page components
│   ├── components/          # Shared components
│   └── store/               # Zustand store
├── types/                   # TypeScript definitions
└── utils/                   # Shared utilities
    └── selector-repository.ts  # ALL selectors centralized here
```

### Key Design Principles
- **Configuration-driven**: No hardcoded selectors, URLs, or credentials
- **Modular architecture**: Each service has single responsibility
- **Single source of truth**: SQLite for state, Google Sheets for export only
- **Never miss transactions**: Reliability > speed
- **Never duplicate**: Two-stage duplicate detection

## 📊 Performance Targets
- Idle CPU: <5%
- Monitoring CPU: <15%
- Memory: <400 MB
- 24/7 continuous operation

## 📝 License

MIT License

## 🔒 Security Notes

- Never logs credentials, tokens, or sensitive data
- Service account credentials stored locally (never transmitted)
- Read-only operations on web panel (no writes)


## Controlled Windows validation

Run `npm test` for build/typecheck and all package suites. The opt-in standalone
`npm run validate:read-only -- --help` workflow constructs no database/export engine.
Follow the [Windows Phase 3 runbook](docs/phase3-windows-live-validation.md) only after
independent review; production Start Monitoring is not a dry-run. Native Windows
packaging/execution and controlled live-panel checks remain separate release gates.
