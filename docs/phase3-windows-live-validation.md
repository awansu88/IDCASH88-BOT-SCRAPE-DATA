# Phase 3 Windows operator runbook

These are **future operator instructions**, to be used only after independent review
approves the exact Phase 3 commit. No live validation, merge, deployment, or production
export has been authorized by preparing this runbook. Do not click production **Start
Monitoring** during initial validation.

## Requirements and isolation

- Windows 10/11 **x64**, a writable working directory, Git, and Node **22 LTS ≥22.12**
  with npm. This minimum follows the locked `@electron/rebuild` tool, not Electron's
  embedded Node version. Native fallback compilation may also require Python 3 and
  Visual Studio 2022 Build Tools with Desktop development with C++.
- The lockfile selects Electron **28.3.3** and Playwright **1.42.0**. Electron's Chromium
  renders the dashboard; scraping uses a **separate Playwright Chromium**. The portable
  build bundles Windows `chrome-win/chrome.exe` plus its DLL/resource files. It does
  not depend on the operator installing system Chrome. Running the portable executable
  needs no Node installation; building and using the standalone validation CLI do.
- Do not put a portable executable under Program Files, a read-only share, or a
  protected folder. Its business data is written next to the original executable in
  `LiveDepositMonitor-Data`. Installed mode uses Electron `app.getPath('userData')`.
- Close the existing application using **Stop Monitoring**, wait for its current work,
  then **tray → Exit**. Closing the window alone leaves it running in the tray. The existing tray
  Pause/Resume items have no handlers; use the dashboard Stop/Start controls,
  and use only tray Exit to quit. Back
  up the entire existing data directory while closed, including `monitoring.db`, any
  `-wal`/`-shm`, config, credentials, browser profile and logs. Keep these backups private.
- Test the packaged dashboard in **Windows Sandbox/a disposable VM or a separate
  Windows user account without production configuration**. This also tests the lack of
  a preinstalled Playwright cache. A different portable folder alone does not prove
  isolation of Electron's own global cache/single-instance state. Never copy production
  credentials or databases into the startup smoke-test instance.

## 1. Checkout the reviewed source

Example checkout: `%USERPROFILE%\source\IDCASH88-phase3`. Substitute your own writable
path everywhere. If reusing a checkout, inspect `git status --short` and preserve local
changes first; do not reset them. Use the exact **approved Phase 3 SHA**, not the old
starting SHA or an unreviewed future branch tip.

CMD:

```bat
if not exist "%USERPROFILE%\source" mkdir "%USERPROFILE%\source"
cd /d "%USERPROFILE%\source"
git clone --branch fix/deposit-dom-resilience-v1 https://github.com/awansu88/IDCASH88-BOT-SCRAPE-DATA.git IDCASH88-phase3
cd /d "%USERPROFILE%\source\IDCASH88-phase3"
git checkout --detach APPROVED_PHASE3_SHA
git rev-parse HEAD
node --version
npm --version
```

PowerShell (use `.cmd` shims if script execution policy blocks npm.ps1):

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\source" | Out-Null
Set-Location "$env:USERPROFILE\source"
git clone --branch fix/deposit-dom-resilience-v1 https://github.com/awansu88/IDCASH88-BOT-SCRAPE-DATA.git IDCASH88-phase3
Set-Location "$env:USERPROFILE\source\IDCASH88-phase3"
git checkout --detach APPROVED_PHASE3_SHA
git rev-parse HEAD
node --version
npm.cmd --version
```

Replace `APPROVED_PHASE3_SHA` before executing it. Use normal GitHub authentication;
never paste tokens, passwords or cookies into chat or these commands.

## 2. Install and verify

Staging installation avoids building SQLite for the build host's Node ABI before
rebuilding it for Electron. It does **not** disable artifact/TLS verification. Do not
use `NODE_TLS_REJECT_UNAUTHORIZED=0` or turn off integrity checks.

CMD:

```bat
npm ci --ignore-scripts
node node_modules\electron\install.js
npm run rebuild
set "PLAYWRIGHT_BROWSERS_PATH=%LOCALAPPDATA%\IDCASH88-Phase3-Browsers"
npx playwright install chromium
npm test
npm run build
npm run typecheck:renderer
```

PowerShell:

```powershell
npm.cmd ci --ignore-scripts
node .\node_modules\electron\install.js
npm.cmd run rebuild
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\IDCASH88-Phase3-Browsers"
npx.cmd playwright install chromium
npm.cmd test
npm.cmd run build
npm.cmd run typecheck:renderer
```

Stop on a nonzero exit. `npm test` builds main/renderer, typechecks renderer and runs
all named package suites, including the historical verifiers and native SQLite gates.
Native SQLite checks run using Electron, not ordinary Node. If native rebuilding
fails, install the prerequisites above and rerun `npm run rebuild`; do not reuse a
Node-ABI `.node` file or ignore a failed native test.

## 3. Build and inspect the portable artifact

CMD:

```bat
npm run dist:portable
dir dist-build\LiveDepositMonitor-Portable.exe
```

PowerShell:

```powershell
npm.cmd run dist:portable
Get-Item .\dist-build\LiveDepositMonitor-Portable.exe
Get-FileHash .\dist-build\LiveDepositMonitor-Portable.exe -Algorithm SHA256
```

The workflow builds both processes, bundles/verifies Windows Chromium, runs
`electron-builder --win portable --x64`, then checks the staged resources and the
**exact** portable filename. An NSIS Setup.exe is not a substitute. Expect
`dist-build\win-unpacked\resources\browsers\chromium-<revision>\chrome-win\chrome.exe`,
its runtime DLLs/paks/data and `BUNDLE_INFO.json`, plus Electron `resources\app.asar`
and unpacked `better-sqlite3` native files. Browser resources are copied outside ASAR
once, not duplicated inside it. The missing custom icon reference was removed; the
Electron default application icon is used.

A successful cross-build is **not native Windows execution evidence**. Verify on the
clean Windows instance described above. Copy **only** the new executable into a new
writable folder (for example `%LOCALAPPDATA%\IDCASH88-Validation`) and launch it:

```bat
"%LOCALAPPDATA%\IDCASH88-Validation\LiveDepositMonitor-Portable.exe"
```

```powershell
& "$env:LOCALAPPDATA\IDCASH88-Validation\LiveDepositMonitor-Portable.exe"
```

Check dashboard/preload IPC, blank configuration handling, window and tray behavior,
and writable data creation. Do not enter Sheets credentials or start monitoring.
Use Stop then tray Exit. Check the isolated folder's `LiveDepositMonitor-Data\config`,
`database`, `logs`, `logs\screenshots`, `browser-profile`, and `credentials`. Missing
Chromium must show the friendly browser-not-found message; it must not silently run
monitoring. Do not remove browsers from a production installation to test this.
In a disposable copy only, temporarily rename the packaged browser directory and
ensure no fallback cache is masking the missing-browser check.

## 4. Prepare a private, bounded validation profile

Use the source checkout and the browser cache configured in step 2. The standalone
CLI does not launch the Electron dashboard or load its production data/config. Create
one **separate** JSON profile, then edit its name/agent/depositType to match an existing
authorized profile. Only `name`, `agent`, and `depositType` are accepted; copy those values rather than
the whole production profile object. Unsupported keys fail before login. Keep it
local; do not paste identifiers here or upload the file.
Do not put passwords, cookies, Sheets keys or session tokens in it.

CMD:

```bat
>validation-profile.json echo {"name":"Validation only","agent":"","depositType":""}
notepad validation-profile.json
```

PowerShell:

```powershell
'{"name":"Validation only","agent":"","depositType":""}' | Set-Content -Encoding UTF8 .\validation-profile.json
notepad .\validation-profile.json
```

UTF-8 BOM from Windows PowerShell is supported. Empty agent/depositType means the
existing adapter's unrestricted option, not a narrow sample; set authorized values
and a narrow date range for the initial check. The production filter defaults are
unchanged. The harness defaults to LEGACY and one page, with a hard cap of three.
It does not load or change production filter files.

## 5. Run validation with no Sheets or production-state writes

After approval only, replace `panel.example` with the actual authorized panel origin.
The initial URL must be HTTPS, exactly `/deposit/transactions`, and contain **no query,
fragment, username or password**. Log in normally in the visible browser. Do not copy
cookies from an existing browser or attempt to bypass authentication.

CMD:

```bat
npm run validate:read-only -- --read-only --deposit-url https://panel.example/deposit/transactions --profile-file validation-profile.json --max-pages 1 --mode LEGACY --report validation-legacy-1.json
```

PowerShell:

```powershell
npm.cmd run validate:read-only -- --read-only --deposit-url https://panel.example/deposit/transactions --profile-file .\validation-profile.json --max-pages 1 --mode LEGACY --report .\validation-legacy-1.json
```

Both `--read-only` and the separate profile file are required. The browser profile and
logs are temporary; the context is closed and removed afterward. Report creation is
exclusive: choose a **new filename** for each run; an existing file will not be overwritten.
The CLI constructs no MonitoringEngine, SQLite, fingerprint/dedup service, export queue,
or Google Sheets client. `sheetsWrites=0`, `databaseOpened=false`,
`exportStatus=NOT_ATTEMPTED`, and `resumeMarkerAdvanced=false` must remain true.
A dry-run is never a successful export.

What “read-only” permits: normal manual authentication/cookies and the existing
read/filter GET or form POST requests. These can change the server's session state.
It does not permit automated transaction actions or Sheets writes. Same-origin
routing restricts reads to the known deposit endpoint, normal authentication routes
and static assets; other endpoints/methods, unknown filter fields, cross-origin
requests and WebSockets are blocked. Service workers are disabled and API automatic
redirects are disabled. If the panel requires unrecognized SSO/CDN/autocomplete routes,
stop and obtain a separate reviewed adjustment; do not disable the guard.

Before pressing Enter, select **both dates**, wait for the deposit table to fully load,
and return to Page 1. Do not use transaction approve/reject/process buttons. LEGACY
applies the profile using the existing browser interface. FAST/AUTO use the existing
HTTP filter resolver and may leave the displayed browser table unchanged: manually
match the visible filter values/dates to the local profile before comparing totals.

## 6. Compare evidence and test boundaries

- Read the JSON summary and safe structural diagnostic codes. `preflight` describes
  the table before source acquisition; it alone is not an overall success.
- Require `failed=false`, zero blocked requests, no unrecognized timestamp values,
  and an expected termination (`MAX_SCAN_REACHED` or `END_OF_PAGINATION`). Exit 1 is a
  failed validation; exit 130 means operator cancellation.
- Compare `rowsParsed` and each trusted page's counts against the panel's real rows.
  Placeholder rows are not transactions. Compare nominal amount sums page by page,
  using exactly the same filters. Verify the currency in the panel before treating
  `amountTotal` as IDR; the report explicitly uses parser integer units and rounding.
- Compare process-date and created-at ranges as displayed. They are not converted
  into another timezone. Unknown nonempty timestamp text is counted, not copied into
  the report. Do not upload transaction names/account numbers to explain a mismatch.
- The sanitized offline 18H/16B reference has 20 transactions, zero rejections, one
  empty 19-cell placeholder and 1,628,758 IDR. Live results need not equal that sample.
- Repeat with `--max-pages 2` and then `3`, using new report names. Compare page 1 and
  page 2 separately. The validation harness intentionally disables duplicate-page
  stopping and does not read production dedup state; repeated rows remain in its
  raw acquisition counts. Existing offline tests cover fully duplicated-page stopping.
- Repeat the same bounded profile with `--mode FAST` and `--mode AUTO` after manual
  relogin. AUTO reports its selected source. Do not infer that a different mode ran
  if the guard or transport failed, and do not force fallback on a schema error.
- Test schema mismatch/partial loading using `npm run test:adaptive-deposit` and
  `npm run test:read-only`, not by altering a live admin table. For session expiry,
  leave a disposable validation login idle until its normal expiry, then attempt
  the bounded scan. Do not manipulate cookies/tokens or disable the guard to force
  sign-out. A login HTML response is SESSION_EXPIRED; a blocked/302 redirect or
  expired session during filter submission can instead fail as HTTP_FAILURE or a
  guarded operation error. None may become a successful empty scan. A missing/unsafe table must not become a valid empty
  result; an unsafe later page must exclude its rows and stop pagination.
- Ctrl+C requests cooperative stop. An in-flight browser/HTTP operation may finish
  or time out first; there is no export to drain. Close any remaining validation
  browser after an abnormal process kill. Never collect the temporary browser
  profile; remove only that abandoned `idcash-read-only-*` temp directory after its
  browser is closed. Never delete production browser profiles or databases.

## 7. Evidence, release gates and rollback

Collect only commit SHA, Node/Electron/Playwright versions, portable SHA-256, build/test
exit statuses, validation mode/page limit, row counts, nominal totals, timestamp ranges,
structural signatures/codes, and the generated summary. Redact screenshots locally;
never share passwords, session cookies/CSRF tokens, raw banking details, profile files,
temporary browser folders, production databases, or unredacted logs.

The Linux preparation did **not** produce a Windows executable: packaging stopped
because Windows Chromium was absent. It also could not execute a GUI without X11.
Windows build, clean-machine launch, native Windows SQLite ABI, writable-path behavior,
packaged Chromium launch, Defender/single-instance/tray behavior, manual login, actual
filter/pagination equivalence and absence of unintended panel mutations are release
**gates still requiring Windows evidence**, not passes. No live test starts until
independent review approves Phase 3 and the operator's controlled plan.

For rollback: stop/exit the validation instance, discard only its disposable state,
and keep the prior production executable and data together. Do not replace/delete
production data to finish a validation. If a later authorized upgrade needs rollback,
close the app first and restore the reviewed known-good executable with its compatible
closed-state backup under a separately approved plan. Never restore a stale database
blindly after any real Sheets writes; reconcile remote Sheets and local durable state
first. Do not use Reset Everything, database cleanup, or resume-marker edits as a
rollback mechanism. This phase does not automatically enable live exports.
