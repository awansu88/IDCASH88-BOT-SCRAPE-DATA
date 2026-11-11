/** Hotfix 13H verifier. Portable: source-only; no Electron, browser, DB, or network. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'd897b98f5f4d6633b32e148e65186a0669bacc05';
const app = fs.readFileSync(path.join(ROOT, 'src/renderer/App.tsx'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'src/renderer/pages/MonitoringPage.tsx'), 'utf8');

const listener = app.slice(app.indexOf('window.electron.onStateChange'), app.indexOf('window.electron.onStatsUpdate'));
const tone = page.slice(page.indexOf('const stateTone'), page.indexOf('/**\n * Compact live-status'));
const startButton = page.match(/^.*data-testid="start-monitoring-btn".*$/m)?.[0] || '';
const stopButton = page.match(/^.*data-testid="stop-monitoring-btn".*$/m)?.[0] || '';
const health = page.match(/<InfoRow label="Monitoring">[^\n]+/)?.[0] || '';

// A, F: backend terminal states update both renderer state dimensions.
assert.match(listener, /setMonitoringState\(state as any\)/);
assert.match(listener, /state === 'PAUSED'/);
assert.match(listener, /state === 'IDLE'/);
assert.match(listener, /setIsMonitoring\(false\)/);

// B: PAUSED wins before the generic stopped presentation.
assert.match(tone, /if \(state === 'PAUSED'\) return \{ tone: 'warning', label: 'Paused' \};/);
assert(tone.indexOf("state === 'PAUSED'") < tone.indexOf('!isMonitoring'));

// C-E: controls and health remain driven by synchronized isMonitoring state.
assert.match(startButton, /isMonitoring/);
assert.match(startButton, /!validationResult\?\.canStartMonitoring/);
assert.match(stopButton, /!isMonitoring/);
assert.match(health, /isMonitoring\s+\? 'Running'\s+: 'Stopped'/);

// G-H: retry/backoff and processing states never clear the running flag.
assert.doesNotMatch(listener, /state === 'ERROR'/);
assert.doesNotMatch(listener, /state === 'SLEEPING'/);
for (const state of ['LOADING_FILTERS', 'SCANNING_PAGE', 'PARSING_HTML', 'VALIDATING',
  'CHECKING_DUPLICATES', 'BUFFERING', 'EXPORTING', 'UPDATING_CACHE']) {
  assert(!listener.includes(state));
}

// I-J: state events do not initiate monitoring or other operator/browser actions.
assert.doesNotMatch(listener, /startMonitoring|handleStartMonitoring|login|navigate|goto|reload|launchBrowser|openBrowser/i);

// K-L: backend 13G, dependency manifests, lockfiles, and schema are frozen.
const changed = execFileSync('git', ['diff', '--name-only', BASE, '--'], { cwd: ROOT, encoding: 'utf8' })
  .trim().split(/\r?\n/).filter(Boolean);
const frozenBackend = [
  'src/main/services/monitoring-engine.ts',
  'src/main/services/monitoring-failure-policy.ts',
  'src/main/ipc-handlers.ts',
  'src/main/preload.ts',
];
// Phase 2 authorizes shared parsing, fail-safe acquisition and diagnostic redaction.
// Pin those exact reviewed implementations while retaining all other restrictions.
const phase2Baselines = {
  "src/main/services/monitoring-failure-policy.ts": "9db506b7f5b9a8f74a83f009ca4e4bfecc294ff27ac07aa86ae5f25fa8da0ecb",
  "src/main/services/monitoring-engine.ts": "7c0c61f9c33062a9c4e30e373d34ef09318add6f910adbb467792a458c63e1d7",
  "src/main/sources/raw-http-html-parser.ts": "b6ea15f76bdb299827369a0639a86f76265641ebe4349dc79b200c39417a7a68",
  "src/main/sources/fast-http-source-adapter.ts": "ac2cf0d7b93e74f995c36c8b2b7726ba2bb82154708dd76f24c613ffc3bca33d",
  "src/main/sources/deposit-column-resolver.ts": "44c63370864c602a330d83810b3c1ff4bb456e95c8a4a4a47ed8aa4b18383bbe",
  "src/main/sources/deposit-page-parser.ts": "384fb9d3c9607ca52bf2d750ff35fbda5ada1f1fcfd0e31635fee744fdb44f8d"
};
for (const [file, expected] of Object.entries(phase2Baselines)) {
  assert.strictEqual(require('crypto').createHash('sha256').update(
    fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex'), expected);
}
assert(!changed.some(file => !phase2Baselines[file] && (frozenBackend.includes(file) ||
  (file.startsWith('src/main/sources/') && file !== 'src/main/sources/deposit-table-layouts.ts'))));
assert(!changed.some(file => /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(file)));
assert(!changed.some(file => /(^|\/)(schema|schemas|migrations)(\/|$)/i.test(file)));

const basePackage = JSON.parse(execFileSync('git', ['show', `${BASE}:package.json`], { cwd: ROOT, encoding: 'utf8' }));
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
assert.deepStrictEqual(packageJson.dependencies, basePackage.dependencies);
assert.deepStrictEqual(packageJson.devDependencies, basePackage.devDependencies);

console.log('PASS: Hotfix 13H cases A-L (paused renderer state synchronization contract).');
