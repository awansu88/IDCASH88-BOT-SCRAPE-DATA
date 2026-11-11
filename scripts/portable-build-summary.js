#!/usr/bin/env node
/**
 * PATCH 13 §4 & §6 — Portable Build Summary + Post-build Verification.
 *
 * Runs AFTER electron-builder finishes.
 *
 * Responsibilities:
 *   1. Inspect the `dist-build/win-unpacked/` staging directory produced
 *      by electron-builder BEFORE it seals it into the Portable.exe.
 *      This checks the staged resources only; it does not establish final
 *      archive integrity or native Windows execution.
 *   2. Confirm the packaged tree contains:
 *          resources/browsers/chromium-<rev>/chrome-win/chrome.exe
 *   3. Locate the final Portable.exe and compute its size.
 *   4. Print the exact "Portable Build Summary" block spec'd in the
 *      ticket:
 *          ✓ Chromium bundled
 *          ✓ Browser version
 *          ✓ Browser path
 *          ✓ Resources copied
 *          ✓ Portable verified
 *          Build size
 *          Browser size
 *          Total package size
 *
 * Any missing artifact → exit 1 so CI fails and the developer knows the
 * build is broken BEFORE they ship it.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(REPO_ROOT, 'dist-build');
const UNPACKED_DIR = path.join(BUILD_DIR, 'win-unpacked');
const BUNDLE_INFO_SOURCE = path.join(REPO_ROOT, 'resources', 'browsers', 'BUNDLE_INFO.json');

function log(m)  { process.stdout.write(m + '\n'); }
function warn(m) { process.stderr.write('WARN: ' + m + '\n'); }
function fail(m) {
  process.stderr.write('\n' + '='.repeat(64) + '\n');
  process.stderr.write('ERROR — Portable build verification failed\n');
  process.stderr.write('='.repeat(64) + '\n');
  process.stderr.write(m + '\n');
  process.stderr.write('='.repeat(64) + '\n\n');
  process.exit(1);
}
function isDir(p)  { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile();      } catch { return false; } }

function measureTree(dir) {
  let bytes = 0;
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) bytes += st.size;
    }
  };
  walk(dir);
  return bytes;
}
function mb(bytes) { return (bytes / (1024 * 1024)).toFixed(1) + ' MB'; }

function findChromiumFolder(root) {
  if (!isDir(root)) return null;
  for (const name of fs.readdirSync(root)) {
    if (/^chromium(?:_headless_shell)?-\d+$/.test(name) && isDir(path.join(root, name))) {
      return { name, full: path.join(root, name) };
    }
  }
  return null;
}

/** Accept only the configured portable artifact; an NSIS setup is not a substitute. */
function findPortableExe() {
  if (!isDir(BUILD_DIR)) return null;
  const expected = require(path.join(REPO_ROOT, 'package.json')).build.portable.artifactName;
  const artifact = path.join(BUILD_DIR, expected);
  return isFile(artifact) ? artifact : null;
}

// -----------------------------------------------------------------------------

(function main() {
  // The unpacked directory MUST exist; if it doesn't, electron-builder
  // either failed silently or was invoked with a target we don't
  // understand. Either way, we cannot verify a portable build.
  if (!isDir(UNPACKED_DIR)) {
    fail([
      `Expected staging directory not found: ${UNPACKED_DIR}`,
      'This script must run AFTER electron-builder has produced win-unpacked/.',
      'If you are only building for macOS or Linux, this verification does not apply.'
    ].join('\n'));
  }

  // 1. Locate the packaged chromium-<rev>/chrome-win/chrome.exe inside the
  //    unpacked resources tree.
  const resourcesRoot = path.join(UNPACKED_DIR, 'resources');
  const browsersRoot = path.join(resourcesRoot, 'browsers');
  const packagedChromium = findChromiumFolder(browsersRoot);
  if (!packagedChromium) {
    fail([
      'The generated Portable package does NOT contain a Chromium browser.',
      '',
      `Inspected: ${browsersRoot}`,
      '',
      'This means electron-builder ran but did not copy the browser into',
      'resources/browsers/. Common causes:',
      '  • bundle-browser.js did not run (check the "prepack" script chain)',
      '  • extraResources in package.json build config is missing the',
      '    { from: "resources/browsers", to: "browsers" } mapping',
      '  • .gitignore or another rule stripped resources/browsers/ at build time'
    ].join('\n'));
  }
  const chromeExe = path.join(packagedChromium.full, 'chrome-win', 'chrome.exe');
  if (!isFile(chromeExe)) {
    fail([
      `Packaged chromium is missing chrome-win/chrome.exe`,
      `Expected: ${chromeExe}`
    ].join('\n'));
  }

  // Verify the packaged copies, not only the source tree checked before packing.
  const runtime = ['chrome.dll', 'chrome_100_percent.pak', 'resources.pak',
    'v8_context_snapshot.bin', 'icudtl.dat'];
  const missingRuntime = runtime.filter(name => {
    const file = path.join(path.dirname(chromeExe), name);
    return !isFile(file) || fs.statSync(file).size === 0;
  });
  if (missingRuntime.length) fail(`Packaged Chromium runtime files missing: ${missingRuntime.join(', ')}`);

  // Sizes.
  const browserBytes = measureTree(packagedChromium.full);
  const packageBytes = measureTree(UNPACKED_DIR);
  const buildBytes = packageBytes - browserBytes; // "everything else"

  // 2. Locate the final Portable.exe.
  const portableExe = findPortableExe();
  const portableSizeStr = portableExe ? mb(fs.statSync(portableExe).size) : '(not produced)';
  const portableName = portableExe ? path.basename(portableExe) : '(unknown)';

  // 3. Read bundle info for the version.
  let browserVersion = 'unknown';
  let playwrightVersion = 'unknown';
  let chromiumRevision = packagedChromium.name.split('-').pop();
  if (isFile(BUNDLE_INFO_SOURCE)) {
    try {
      const info = JSON.parse(fs.readFileSync(BUNDLE_INFO_SOURCE, 'utf8'));
      browserVersion = info.browserVersion || 'unknown';
      playwrightVersion = info.playwrightVersion || 'unknown';
      chromiumRevision = info.chromiumRevision || chromiumRevision;
    } catch { /* best-effort */ }
  }
  // If BUNDLE_INFO didn't have a real version and the packaged tree has
  // chrome-win/version.txt, prefer that.
  if (browserVersion === 'unknown') {
    const verFile = path.join(packagedChromium.full, 'chrome-win', 'version.txt');
    if (isFile(verFile)) {
      try { browserVersion = fs.readFileSync(verFile, 'utf8').trim() || 'unknown'; } catch {}
    }
  }

  const relBrowserPath = path.relative(UNPACKED_DIR, chromeExe).replace(/\\/g, '/');

  // 4. Print the exact summary block spec'd in the ticket.
  const line = '='.repeat(60);
  log('');
  log(line);
  log('                Portable Build Summary');
  log(line);
  log(`  \u2713 Chromium bundled       ${packagedChromium.name}`);
  log(`  \u2713 Browser version        ${browserVersion}`);
  log(`  \u2713 Browser path           ${relBrowserPath}`);
  log(`  \u2713 Resources copied       ${path.relative(UNPACKED_DIR, resourcesRoot).replace(/\\/g, '/') || 'resources/'}`);
  log(`  ${portableExe ? "✓" : "✗"} Portable artifact      ${portableName}`);
  log('');
  log(`  Build size              ${mb(buildBytes)}`);
  log(`  Browser size            ${mb(browserBytes)}`);
  log(`  Total package size      ${mb(packageBytes)}`);
  log(`  Portable file size      ${portableSizeStr}`);
  log('');
  log(`  Playwright version      ${playwrightVersion}`);
  log(`  Chromium revision       ${chromiumRevision}`);
  log(line);
  log('');
  if (!portableExe) {
    warn('Portable.exe was not found under dist-build/. The staged tree is complete,');
    warn('but electron-builder did not seal it. Re-run: npm run dist:portable');
    process.exit(1);
  }
  log('Portable build is complete AND self-contained.');
})();
