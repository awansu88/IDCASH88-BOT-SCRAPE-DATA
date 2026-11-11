# Live Deposit Monitor — Portable Build Guide

This document is the complete workflow for producing a **self-contained
Portable.exe** that can be copied to any clean Windows PC and run
immediately — no Playwright install, no browser install, no AppData
dependency.

> **Patch 13** hardens the packaging pipeline so a browser-less
> Portable.exe can never be produced. Any step that fails aborts the
> build immediately (fail-fast).

---

## 0. Prerequisites (one-time)

| Requirement       | Notes                                              |
| ----------------- | -------------------------------------------------- |
| Node.js **22 LTS ≥22.12** | Required by the locked Electron rebuild tooling.                                 |
| Windows **10/11** | Required for producing `dist:portable`.            |
| Playwright cache  | Located at `%LOCALAPPDATA%\ms-playwright` (default) |

> **Cross-compiling from macOS or Linux is possible** but the build
> host must have a Windows-x64 Playwright cache reachable via
> `PLAYWRIGHT_BROWSERS_PATH`. Native builds on Windows are strongly
> recommended.

---

## 1. Install dependencies

```powershell
npm.cmd ci --ignore-scripts
node .\node_modules\electron\install.js
npm.cmd run rebuild
```

`postinstall` rebuilds `better-sqlite3` for the current Electron
version. If that ever fails, run:

```powershell
npm run rebuild:native
```

---

## 2. Install Chromium (Playwright-managed)

```powershell
npx playwright install chromium
```

This drops `chromium-<rev>/chrome-win/chrome.exe` into
`%LOCALAPPDATA%\ms-playwright` (or wherever `PLAYWRIGHT_BROWSERS_PATH`
points).

> Only **Chromium** is needed — Firefox / WebKit / ffmpeg are
> intentionally not bundled to keep the Portable.exe small.

---

## 3. Bundle the browser into `resources/browsers/`

```powershell
npm run bundle:browser
```

The bundler:
1. Looks for the newest `chromium-<rev>/` in
   * `PLAYWRIGHT_BROWSERS_PATH`, then
   * the platform-default cache (`%LOCALAPPDATA%\ms-playwright` on Windows,
     `~/Library/Caches/ms-playwright` on macOS,
     `~/.cache/ms-playwright` on Linux).
2. Copies **only** `chromium-<rev>/` (not the whole cache) into
   `resources/browsers/`.
3. Writes `resources/browsers/BUNDLE_INFO.json` with:
   ```json
   {
     "playwrightVersion": "...",
     "chromiumRevision": "...",
     "browserVersion": "...",
     "platform": "...",
     "architecture": "...",
     "generatedAt": "...",
     "browserSize": ...,
     "filesBundled": ...
   }
   ```

Idempotent: if a valid `chrome.exe` is already staged, the script
skips the copy and only refreshes `BUNDLE_INFO.json`.

---

## 4. Verify the browser bundle

```powershell
npm run verify:browser-bundle
```

The verifier answers **one** question:

> *"Is the bundled Chromium **structurally complete and deployable**?"*

It intentionally does **not** try to answer "will Chromium run under
every possible Windows environment" — that is the launch-time concern
of `playwright.chromium.launchPersistentContext(...)`, and pre-answering
it from a Node script has historically produced false negatives that
rejected genuine, working bundles.

### Three validation levels

| Level | Meaning | Behaviour on failure |
| ----- | ------- | -------------------- |
| **1 — FATAL**   | Bundle is not structurally deployable          | Exit 1, build aborts |
| **2 — WARN**    | Extra confidence signal; environment-dependent | Log warning, continue |
| **3 — INFO**    | Pure reporting                                 | Never affects result |

**Level 1 checks (build-blocking):**
- `resources/browsers/chromium-<rev>/` exists
- `chrome-win/` subfolder exists
- `chrome.exe` exists and has a valid PE header (`MZ`, non-trivial size)
- Required runtime files present: `chrome.dll`, `chrome_100_percent.pak`,
  `resources.pak`, `v8_context_snapshot.bin`, `icudtl.dat`
- `BUNDLE_INFO.json` is valid JSON and contains all 8 required keys

**Level 2 checks (warning only, never block):**
- `chrome.exe --version` opportunistic probe (Windows only) — kept
  purely as an extra positive signal. Its failure is **not**
  authoritative because the app launches Chromium via Playwright, not
  by direct invocation
- Optional companion files: `chrome_200_percent.pak`, `version.txt`
- `locales/` folder present (headless_shell variants omit it)
- `swiftshader/` folder present

**Level 3 checks (informational):**
- Chromium revision, Chromium version, Playwright version, bundle
  size, file count, build timestamp, executable path

### Adding new checks in the future

If you need to add a new signal, place it as follows:

- **Structural + cannot-run-without-it** → Level 1
- **Extra confidence, environment-dependent** → Level 2
- **Reporting only** → Level 3

**NEVER add environment-dependent checks (executables running,
network calls, permission probes, …) to Level 1.** If it can
legitimately fail on a working bundle in some environment, it belongs
in Level 2.

---

## 5. Build the Portable executable

```powershell
npm run dist:portable
```

Under the hood this now performs:

```
npm run build          # tsc + vite
  ↓
npm run prepack:portable
   ↳ npm run bundle:browser
   ↳ npm run verify:browser-bundle
  ↓
electron-builder --win portable --x64
  ↓
npm run portable:summary
```

If any step above fails, the build aborts and **no `.exe` is
produced** — that's the point.

The Portable.exe is written to
`dist-build/LiveDepositMonitor-Portable.exe`.

---

## 6. Verify the produced portable package

`npm run portable:summary` runs automatically at the end of
`dist:portable`, but you can rerun it standalone:

```powershell
npm run portable:summary
```

It inspects `dist-build/win-unpacked/` — the exact tree
electron-builder sealed into `Portable.exe` — and prints:

```
============================================================
                Portable Build Summary
============================================================
  ✓ Chromium bundled       chromium-<rev>
  ✓ Browser version        Chromium XXX.X.XXXX.XXX
  ✓ Browser path           resources/browsers/chromium-<rev>/chrome-win/chrome.exe
  ✓ Resources copied       resources
  ✓ Portable verified      LiveDepositMonitor-Portable.exe

  Build size              XX.X MB
  Browser size            XXX.X MB
  Total package size      XXX.X MB
  Portable file size      XXX.X MB

  Playwright version      X.YY.Z
  Chromium revision       <rev>
============================================================
```

If the packaged tree is missing `chrome.exe` the script fails with an
actionable error — the build is deemed unshippable.

---

## 7. Deploy

Copy `dist-build/LiveDepositMonitor-Portable.exe` to a **clean**
Windows PC and double-click. On first launch:

- The app resolves Chromium in this order:
  1. `resources/browsers/chromium-<rev>/chrome-win/chrome.exe`  ← the
     bundled one
  2. `PLAYWRIGHT_BROWSERS_PATH`
  3. `%LOCALAPPDATA%\ms-playwright`
- **Playwright is launched with `executablePath` pointing directly at
  the resolved chrome.exe** (Patch 13.3). This bypasses Playwright's
  internal revision-number lookup — a critical detail because
  `playwright-core@1.42.0` has a hardcoded expected revision (1105)
  that will almost never match the revision the developer's `npx
  playwright install` produced. Passing `executablePath` makes the
  revision mismatch irrelevant.
- If none of the above yields a usable Chromium, a **friendly dialog**
  is shown (never Playwright's raw stack trace). It offers three
  buttons: **Copy Diagnostic**, **Open Log Folder**, **Close**.

---

## Troubleshooting

### "Bundled Chromium not found." during `bundle:browser`
Playwright hasn't downloaded Chromium yet. Run:
```powershell
npx playwright install chromium
```

### "chrome.exe missing" during `verify:browser-bundle`
Your Playwright cache has a non-Windows Chromium (e.g. `chrome-linux/`
or `chrome-mac/`). Either build on Windows or set
`PLAYWRIGHT_BROWSERS_PATH` to a Windows cache.

### Antivirus quarantines Chromium
Add the `resources/browsers/` folder (dev) and the deployed
`LiveDepositMonitor-Portable.exe` location (prod) to the antivirus
exclusion list. The bundled Chromium is a standard Playwright build,
never a modified binary.

### App runs but says "Chromium Browser Not Found"
Click **Copy Diagnostic** in the dialog, then **Open Log Folder**, and
attach both to a support request. The diagnostic includes the full
resolution trail, Electron/Node/Playwright versions, and the exact
paths that were probed.

---

## Files touched by Patch 13 (deployment-only)

| Path                                              | Purpose                             |
| ------------------------------------------------- | ----------------------------------- |
| `scripts/bundle-browser.js`                       | Copies chromium-<rev>/ + BUNDLE_INFO |
| `scripts/verify-browser-bundle.js`                | Fail-fast pre-build validation      |
| `scripts/portable-build-summary.js`               | Post-build verification & summary   |
| `src/main/services/browser-resolver.ts`           | Runtime resolution + friendly dialog |
| `src/main/index.ts`                               | Delegates to browser-resolver       |
| `src/main/services/playwright-service.ts`         | Launch wrapped in friendly dialog   |
| `src/main/services/maintenance-service.ts`        | Diagnostic report additions         |
| `package.json`                                    | Script chain rewired                |
| `.gitignore`                                      | `resources/browsers/` excluded      |

**Monitoring engine, PageScanner, HTMLMapper, TransactionValidator,
FingerprintGenerator, Duplicate Detection, SQLite schema, Resume
Marker, Google Sheets export, and the entire renderer dashboard are
UNTOUCHED.**


## Phase 3 controlled validation

See [Windows operator runbook](docs/phase3-windows-live-validation.md) for isolated
startup, the opt-in no-write harness, build/test commands, native Windows release
gates and rollback. Do not use production Start Monitoring as a dry-run: it can
claim SQLite rows and drain pending Sheets exports.
