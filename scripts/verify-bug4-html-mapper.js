/**
 * Runtime verification for BUG #4 (HTML Mapper).
 * Fixture reproduces the production panel: 16 data columns + SubTotal/Total
 * footer rows with colspan (as seen in operator screenshot).
 */
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

// Reproduces the operator screenshot's table structure verbatim.
const TABLE_HTML = `<!doctype html><html><body>
<table class="table table-striped b-t">
<thead>
  <tr>
    <th>#</th><th>User Name</th><th>Bank</th><th>Account Name</th><th>Account Number</th>
    <th>Payment ID</th><th>Currency</th><th>Amount</th><th>Status</th><th>External Id</th>
    <th>Done?</th><th>Deposit Type</th><th>Payment Type</th><th>Agent</th><th>Process Date</th><th>Created At</th>
  </tr>
</thead>
<tbody>
  <!-- Data rows (2 valid, 1 invalid amount, 1 missing user name) -->
  <tr><td>1</td><td>alice01</td><td>BCA</td><td>Alice</td><td>1234567890</td><td>P1</td><td>USD</td><td>1,250.00 USD</td><td>Approved</td><td>EXT1</td><td>Yes</td><td>Bank Transfer</td><td>Manual</td><td>agentA</td><td>2026-07-22 10:00:00</td><td>2026-07-22 10:01:00</td></tr>
  <tr><td>2</td><td>bob02</td><td>BNI</td><td>Bob</td><td>2345678901</td><td>P2</td><td>USD</td><td>500.50</td><td>Approved</td><td>EXT2</td><td>Yes</td><td>Bank Transfer</td><td>Manual</td><td>agentB</td><td>2026-07-22 11:00:00</td><td>2026-07-22 11:01:00</td></tr>
  <tr><td>3</td><td>carol03</td><td>Mandiri</td><td>Carol</td><td>3456789012</td><td>P3</td><td>USD</td><td>--</td><td>Approved</td><td>EXT3</td><td>Yes</td><td>Bank Transfer</td><td>Manual</td><td>agentC</td><td>2026-07-22 12:00:00</td><td>2026-07-22 12:01:00</td></tr>
  <tr><td>4</td><td></td><td>BCA</td><td>Dave</td><td>4567890123</td><td>P4</td><td>USD</td><td>800</td><td>Approved</td><td>EXT4</td><td>Yes</td><td>Bank Transfer</td><td>Manual</td><td>agentD</td><td>2026-07-22 13:00:00</td><td>2026-07-22 13:01:00</td></tr>

  <!-- Footer summary rows (from operator screenshot). Small cell count with colspan. -->
  <tr><td colspan="7">SubTotal</td><td>0.00</td><td>Success</td><td colspan="6">0</td></tr>
  <tr><td colspan="7">SubTotal Reject</td><td>0.00</td><td>Rejected</td><td colspan="6">0</td></tr>
  <tr><td colspan="8"></td><td>Dicanceled</td><td colspan="6">0</td></tr>
  <tr><td colspan="7">Total</td><td>0.00</td><td>Success</td><td colspan="6">0</td></tr>
  <tr><td colspan="7">Total Reject</td><td>0.00</td><td>Rejected</td><td colspan="6">0</td></tr>
  <tr><td colspan="7">Total First Deposit</td><td>0</td><td>Dicanceled</td><td colspan="6">0</td></tr>
  <tr><td colspan="7">Total Unique Depositor</td><td>0</td><td colspan="7"></td></tr>
</tbody>
</table>
</body></html>`;

async function main() {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.main.json'], {
    cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
  });
  const { HTMLMapper } = require('../dist/main/main/services/html-mapper');
  const { initializeLogger } = require('../dist/main/main/services/logger-service');
  const tmpLogs = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-'));
  const logger = initializeLogger(tmpLogs);
  logger.setDiagEnabled(true);

  const results = { passed: 0, failed: 0, notes: [] };

  const server = http.createServer((_req, res) => { res.setHeader('content-type','text/html'); res.end(TABLE_HTML); });
  await new Promise(r => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(url);
    const mapper = new HTMLMapper(page);
    const result = await mapper.parseCurrentPage();

    // Assertion 1: exactly the 2 valid data rows are parsed as transactions.
    if (result.transactions.length === 2) {
      results.passed++; results.notes.push(`PASS: parsed 2 valid transactions from the mixed table`);
    } else {
      results.failed++; results.notes.push(`FAIL: expected 2 transactions, got ${result.transactions.length}`);
    }

    // Assertion 2: transaction values are correct (amount parsed, columns aligned).
    const alice = result.transactions.find(t => t.userName === 'alice01');
    if (alice && alice.amount === 1250 && alice.bank === 'BCA' && alice.processDate === '2026-07-22 10:00:00') {
      results.passed++; results.notes.push(`PASS: alice01 parsed with amount=1250, bank=BCA, processDate=2026-07-22 10:00:00`);
    } else {
      results.failed++; results.notes.push(`FAIL: alice01 parsed incorrectly: ${JSON.stringify(alice)}`);
    }
    const bob = result.transactions.find(t => t.userName === 'bob02');
    if (bob && bob.amount === 501) {
      results.passed++; results.notes.push(`PASS: bob02 amount rounded to 501 (from "500.50")`);
    } else {
      results.failed++; results.notes.push(`FAIL: bob02 amount incorrect: ${JSON.stringify(bob)}`);
    }

    // Assertion 3: rejections carry actionable reasons + footer rows are properly categorised.
    const footerRejects = result.rejections.filter(r => r.reason.startsWith('Footer/summary row'));
    if (footerRejects.length === 7) {
      results.passed++; results.notes.push(`PASS: 7 footer/summary rows cleanly categorised (SubTotal/Total variants)`);
    } else {
      results.failed++; results.notes.push(`FAIL: expected 7 footer rejects, got ${footerRejects.length}. Rejections: ${JSON.stringify(result.rejections.map(r=>r.reason))}`);
    }
    const invalidAmount = result.rejections.find(r => r.reason.includes('Invalid Amount Format') || r.reason.includes('Amount'));
    if (invalidAmount) {
      results.passed++; results.notes.push(`PASS: invalid-amount row rejected with reason "${invalidAmount.reason}"`);
    } else {
      results.failed++; results.notes.push(`FAIL: no rejection for invalid-amount row`);
    }
    const missingUser = result.rejections.find(r => r.code === 'MISSING_REQUIRED_FIELD' && r.missingFields.includes('USER_NAME') && !('resolved' in r));
    if (missingUser) {
      results.passed++; results.notes.push(`PASS: missing-user row rejected with sanitized missing-field diagnostic`);
    } else {
      results.failed++; results.notes.push(`FAIL: no sanitized rejection for missing user`);
    }

    // Assertion 4: header-driven column resolution works (verified indirectly by
    // correct field extraction above); no regression on 16-column production layout.
    if (result.transactions.every(t => t.amount > 0 && t.userName && t.processDate)) {
      results.passed++; results.notes.push(`PASS: header-driven column resolution + 16-column layout OK`);
    } else {
      results.failed++; results.notes.push(`FAIL: some transactions have blank fields`);
    }
  } finally {
    await browser.close();
    server.close();
    // Stop and flush rotating transports before removing this test's private directory.
    await logger.close();
    await fs.promises.rm(tmpLogs, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    require('assert').strictEqual(fs.existsSync(tmpLogs), false, 'temporary logs must be removed after logger shutdown');
  }

  console.log('\n=== BUG #4 verification ===');
  for (const n of results.notes) console.log('  •', n);
  console.log(`\nPASSED: ${results.passed}   FAILED: ${results.failed}`);
  process.exitCode = results.failed === 0 ? 0 : 1;
}

main().catch(e => { console.error(e); process.exit(2); });
