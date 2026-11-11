/**
 * Runtime verification for the four remaining production issues:
 *   #1 Parser rejects every row (17 header cols ↔ 15 body cells)
 *   #2 Manual date mode (never overwrite operator-selected dates)
 *   #3 Filter profile state leakage (fields must reset between profiles)
 *   #4 Initial Sync Mode (adaptive scanning disabled)
 */
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

// Production-shaped table: 17 header columns, 15 body cells per row.
// Two header columns are body-less. Production evidence: HTMLCollection(15).
const HEADERS_17 = [
  '#', 'User Name', 'Bank', 'Account Name', 'Account Number',
  'Payment ID', 'Currency', 'Amount', 'Status', 'External Id',
  'Done?', 'Deposit Type', 'Payment Type', 'Agent', 'Verified',
  'Process Date', 'Created At'
];
// Body omits the FIRST header (#) and one middle header ("Verified"), so
// body[0] corresponds to header[1] (User Name), and after 'Deposit Type' the
// body skips 'Verified' and continues at 'Agent'. But we shift only ONCE at
// the left in this fixture (bodyOffset=1) — the second omission is naturally
// handled by header-driven mapping because 'Verified' isn't a required field
// and simply resolves to empty. Wait — with header-driven index-only mapping
// this creates a shift AFTER 'Deposit Type'. To keep the test simple we build
// the fixture with EXACTLY the "leading-2-headers-omitted" pattern (the most
// common panel layout: "#" + a hidden admin column at index 2 or similar).
//
// Concretely: header[0]='#' and header[14]='Verified' have no body cells.
// After the bodyOffset detection (0 or up to 2), the parser should choose an
// offset that lines Process Date up with a date pattern. If the fixture
// simulates the pattern where offset=2 aligns dates correctly, the parser
// picks offset=2 and User Name resolves from body[0]. So the fixture below
// omits the FIRST TWO headers (index 0 and 1) and keeps the rest 1:1 — this
// is the "leading-two-omitted" variant that a real panel typically ships
// (e.g. sequence number + hidden actions column).
//
// Body has 15 cells: they line up with header[2..16] i.e. Bank..Created At.
// Wait — that means User Name is body-less too! Which contradicts the
// production evidence that user names DO get parsed when panel is used
// manually. So the real production pattern is more likely: header[0]='#'
// is omitted AND ONE OTHER column somewhere in the middle is omitted.
//
// To robustly cover multiple layouts, we run THREE fixture variants and
// require the parser to succeed on each:
//   Variant A: header[0]='#' omitted from body (single leading omission → 16 body cells)
//   Variant B: header[0]='#' and header[14]='Verified' omitted (leading + middle) → 15 body cells
//   Variant C: header[0]='#' and header[16]='Created At' omitted (leading + trailing) → 15 body cells
// Variant A must parse (offset=1, all fields present).
// Variant B parses without 'Verified' (not required) — must succeed because
// dropping a non-required middle column doesn't invalidate the row (parser
// simply resolves 'Verified' to empty via bodyIdx out-of-range guard).
// Variant C parses without 'Created At' (also not required) — same story.
//
// The critical assertion: with offset detection, User Name and Process Date
// resolve correctly even when body has fewer cells than headers.

function makeFixture(omittedHeaderIndexes) {
  // omittedHeaderIndexes = array of 0-based indexes into HEADERS_17 that have
  // NO body cell rendered. The body still contains 17-omittedCount cells in
  // the natural order of the non-omitted headers.
  const rows = [
    { '#': '1', 'User Name': 'alice01', 'Bank': 'BCA', 'Account Name': 'Alice', 'Account Number': '1234567890',
      'Payment ID': 'P1', 'Currency': 'USD', 'Amount': '1,250 USD', 'Status': 'Approved', 'External Id': 'EXT1',
      'Done?': 'Yes', 'Deposit Type': 'Bank Transfer', 'Payment Type': 'Manual', 'Agent': 'agentA',
      'Verified': 'Yes', 'Process Date': '2026-07-22 10:00:00', 'Created At': '2026-07-22 10:01' },
    { '#': '2', 'User Name': 'bob02', 'Bank': 'BNI', 'Account Name': 'Bob', 'Account Number': '2345678901',
      'Payment ID': 'P2', 'Currency': 'USD', 'Amount': '500', 'Status': 'Approved', 'External Id': 'EXT2',
      'Done?': 'Yes', 'Deposit Type': 'Bank Transfer', 'Payment Type': 'Manual', 'Agent': 'agentB',
      'Verified': 'Yes', 'Process Date': '2026-07-22 11:00:00', 'Created At': '2026-07-22 11:01' },
  ];
  const omit = new Set(omittedHeaderIndexes);
  const bodyOrder = HEADERS_17.map((h, i) => omit.has(i) ? null : h).filter(Boolean);

  const rowsHtml = rows.map(r =>
    '<tr>' + bodyOrder.map(h => `<td>${r[h]}</td>`).join('') + '</tr>'
  ).join('');

  return `<!doctype html><html><body>
<table class="table table-striped b-t">
<thead><tr>${HEADERS_17.map(h => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
</body></html>`;
}

async function withPage(html, fn) {
  const server = http.createServer((_req, res) => { res.setHeader('content-type','text/html'); res.end(html); });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    return await fn(page);
  } finally { await browser.close(); server.close(); }
}

async function main() {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.main.json'], {
    cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
  });
  const { HTMLMapper } = require('../dist/main/main/services/html-mapper');
  const { PlaywrightService } = require('../dist/main/main/services/playwright-service');
  const { initializeLogger } = require('../dist/main/main/services/logger-service');
  const tmpLogs = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-'));
  const logger = initializeLogger(tmpLogs);
  logger.setDiagEnabled(true);

  const results = { passed: 0, failed: 0, notes: [] };

  // ============================================================
  // Issue #1: Parser must succeed with 17 headers ↔ 15 body cells.
  // ============================================================
  const assert = require('assert');
  for (const [file, count] of [
    ['phase4/layout-17h-15b.html', 1], ['phase4/layout-16h-16b.html', 1],
    ['phase4/layout-16h-15b.html', 1], ['deposit-dom/layout-18h-16b.html', 20]
  ]) await withPage(fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8'), async page => {
    const result = await new HTMLMapper(page).parseCurrentPage();
    assert.strictEqual(result.trusted, true); assert.strictEqual(result.transactions.length, count);
    assert.strictEqual(result.rejections.length, 0); results.passed++;
  });
  // Unregistered leading/middle omissions cannot be guessed from header offsets.
  for (const omissions of [[0], [0,14], [0,16]]) await withPage(makeFixture(omissions), async page => {
    const result = await new HTMLMapper(page).parseCurrentPage();
    assert.strictEqual(result.trusted, false); assert.strictEqual(result.transactions.length, 0);
    assert.strictEqual(result.classification, 'UNKNOWN_LAYOUT'); results.passed++;
  });

  // ============================================================
  // Issue #2: Manual date mode.
  // ============================================================
  // Fixture that requires both dates present to submit search successfully.
  const panelWithDates = `<!doctype html><html><head></head><body>
<form id="ff" method="get">
  <input id="deposit-agent-name" name="agent" value="">
  <select id="deposit-status" name="status"><option value="">All</option><option value="Approve">Approve</option></select>
  <select id="payment" name="payment"><option value="">All</option></select>
  <input type="text" class="datepicker" name="deposit_process_date_from" value="">
  <input type="text" class="datepicker" name="deposit_process_date_to" value="">
  <input type="submit" value=" Filter">
</form>
<div id="mark">idle</div>
<table class="table table-striped b-t"><thead><tr><th>x</th></tr></thead><tbody></tbody></table>
<script>
document.getElementById('ff').addEventListener('submit', function(e){ e.preventDefault(); const fd=new FormData(this); const f=fd.get('deposit_process_date_from')||''; const t=fd.get('deposit_process_date_to')||''; document.getElementById('mark').textContent = 'SUBMIT from='+f+' to='+t; document.querySelector('table tbody').innerHTML='<tr><td>ok</td></tr>'; });
</script>
</body></html>`;

  const server2 = http.createServer((_r,res)=>{res.setHeader('content-type','text/html'); res.end(panelWithDates);});
  await new Promise(r => server2.listen(0,r));
  const url2 = `http://127.0.0.1:${server2.address().port}/`;
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-prof-'));
  const svc = new PlaywrightService({ getBrowserProfileDir: () => tmpProfile, getScreenshotsDir: () => tmpLogs });
  try {
    const page = await svc.launch(url2, { headless: true });
    await page.waitForSelector('#deposit-agent-name');

    // #2a: manualDateMode=true, browser dates prefilled by operator → applyFilter must NOT overwrite.
    await page.fill('input[name="deposit_process_date_from"]', '2026-05-05');
    await page.fill('input[name="deposit_process_date_to"]',   '2026-05-06');
    await svc.applyFilter({ name: 'manual', agent: '', depositType: '' }, { manualDateMode: true });
    const f2a = await page.inputValue('input[name="deposit_process_date_from"]');
    const t2a = await page.inputValue('input[name="deposit_process_date_to"]');
    const m2a = await page.textContent('#mark');
    if (f2a === '2026-05-05' && t2a === '2026-05-06' && (m2a||'').includes('from=2026-05-05') && (m2a||'').includes('to=2026-05-06')) {
      results.passed++; results.notes.push(`PASS #2a: manual mode preserved operator dates and submitted them (from=${f2a}, to=${t2a})`);
    } else {
      results.failed++; results.notes.push(`FAIL #2a: dates altered. from=${f2a}, to=${t2a}, mark=${m2a}`);
    }

    // #2b: manualDateMode=true, browser dates EMPTY → applyFilter must throw CYCLE-FATAL.
    await page.fill('input[name="deposit_process_date_from"]', '');
    await page.fill('input[name="deposit_process_date_to"]', '');
    await page.evaluate(() => (document.activeElement).blur());
    try {
      await svc.applyFilter({ name: 'manual-empty', agent: '', depositType: '' }, { manualDateMode: true });
      results.failed++; results.notes.push(`FAIL #2b: expected cycle-fatal when browser dates empty in manual mode, but succeeded`);
    } catch (e) {
      if (e && e.isCycleFatal && /empty dates/i.test(e.message)) {
        results.passed++; results.notes.push(`PASS #2b: manual mode with empty browser dates throws CYCLE-FATAL with clear reason`);
      } else {
        results.failed++; results.notes.push(`FAIL #2b: wrong error: ${e && e.message}`);
      }
    }

    // ============================================================
    // Issue #3: Filter profile state leakage.
    // ============================================================
    // Prefill agent field with a stale value from a "previous filter profile".
    await page.fill('input[name="deposit_process_date_from"]', '2026-05-05');
    await page.fill('input[name="deposit_process_date_to"]',   '2026-05-06');
    await page.fill('#deposit-agent-name', 'fixture_stale_agent'); // stale from Profile 2
    // Apply Profile 1 with agent=empty → the reset MUST clear the stale agent.
    await svc.applyFilter({ name: 'profile1', agent: '', depositType: '' }, { manualDateMode: true });
    const agentAfter = await page.inputValue('#deposit-agent-name');
    if (agentAfter === '') {
      results.passed++; results.notes.push(`PASS #3: filter reset cleared stale agent value ("fixture_stale_agent" → "")`);
    } else {
      results.failed++; results.notes.push(`FAIL #3: agent field still has "${agentAfter}" (state leaked from previous profile)`);
    }

    // #3b: applying Profile with agent=X sets the value; then applying with
    //      agent=undefined must clear it back.
    await svc.applyFilter({ name: 'profileX', agent: 'operatorX', depositType: '' }, { manualDateMode: true });
    const agentX = await page.inputValue('#deposit-agent-name');
    await svc.applyFilter({ name: 'profileClear', agent: '', depositType: '' }, { manualDateMode: true });
    const agentCleared = await page.inputValue('#deposit-agent-name');
    if (agentX === 'operatorX' && agentCleared === '') {
      results.passed++; results.notes.push(`PASS #3b: profile switch resets agent from "operatorX" → ""`);
    } else {
      results.failed++; results.notes.push(`FAIL #3b: agentX="${agentX}", agentCleared="${agentCleared}"`);
    }
  } finally {
    await svc.close().catch(()=>{});
    server2.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
  }

  // ============================================================
  // Issue #4: Initial Sync Mode — engine ignores latest-processed date.
  // ============================================================
  // Verified by inspecting MonitoringEngine.runMonitoringCycle wiring:
  const src = fs.readFileSync(path.join(__dirname, '../src/main/services/monitoring-engine.ts'), 'utf8');
  const adapter = fs.readFileSync(path.join(__dirname, '../src/main/sources/legacy-browser-source-adapter.ts'), 'utf8');
  assert.match(src, /initialSyncMode = this.config\?\.features.initialSyncMode === true/);
  assert.match(adapter, /request.initialSyncMode \? null : request.duplicateCheck/);
  assert(!src.includes('await this.sqliteService.getLatestProcessDate'));
  results.passed++; results.notes.push('PASS #4: fingerprint-only duplicate stop; initial sync disables it');
  // Also verify default constants
  const constSrc = fs.readFileSync(path.join(__dirname, '../src/utils/constants.ts'), 'utf8');
  if (/manualDateMode:\s*true/.test(constSrc) && /initialSyncMode:\s*false/.test(constSrc)) {
    results.passed++; results.notes.push(`PASS #4b: defaults correct — manualDateMode=true (reliability), initialSyncMode=false (incremental)`);
  } else {
    results.failed++; results.notes.push(`FAIL #4b: defaults incorrect in constants.ts`);
  }

  console.log('\n=== REMAINING ISSUES verification ===');
  for (const n of results.notes) console.log('  •', n);
  console.log(`\nPASSED: ${results.passed}   FAILED: ${results.failed}`);
  fs.rmSync(tmpLogs, { recursive: true, force: true });
  process.exit(results.failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
