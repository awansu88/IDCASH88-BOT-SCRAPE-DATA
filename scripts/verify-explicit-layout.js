// Static verification of the (17H, 15B) explicit production layout using
// a sanitized production-shaped fixture. Runs against the
// compiled parser via a lightweight Playwright chromium instance driven
// against a data:text/html URL — no real network, no real deposit panel.

const { chromium } = require('playwright');

// Minimal <thead> matching the production log's HEADER RESOLUTION block.
// Positions 11 and 17 carry labels the alias table does NOT recognise —
// this is intentional (the parser must NOT rely on those labels to align).
const HEAD = `
  <thead><tr>
    <th>#</th><th>User Name</th><th>Bank</th><th>Account Name</th>
    <th>Account Number</th><th>Payment ID</th><th>Currency</th><th>Amount</th>
    <th>Status</th><th>External ID</th><th>Unrecognised-11</th><th>Deposit Type</th>
    <th>Payment Type</th><th>Agent</th><th>Process Date</th><th>Created At</th>
    <th>Unrecognised-17</th>
  </tr></thead>
`;

// Sanitized sample row (15 body cells; PAYMENT_TYPE + col-17 omitted).
const SAMPLE_ROW = `
  <tr>
    <td>5</td>
    <td><a class="opennew" href="#">fixture_user_001</a></td>
    <td>bca</td>
    <td>FICTIONAL HOLDER 001</td>
    <td><span data-bank="bca" data-bank-number="900000000001" class="bank-accnumber">900-000-000001</span></td>
    <td>fixture_user_001</td>
    <td>IDR</td>
    <td>100,763.00</td>
    <td>Approved</td>
    <td>50623679-pga-6a626f3b27c5f</td>
    <td>Yes</td>
    <td>PGA</td>
    <td>N/A</td>
    <td>2026-07-24 02:45:43</td>
    <td>2026-07-24 02:45:00</td>
  </tr>
`;

const html = `<!doctype html><html><body>
  <table class="table table-striped b-t">
    ${HEAD}
    <tbody>${SAMPLE_ROW}</tbody>
  </table>
</body></html>`;

(async () => {
  // Compiled main-process code lives in dist/main/main after `npm run build:main`.
  // Suppress the winston file logger so this smoke test doesn't try to
  // write to APPDATA — the production logger writes rotating files.
  process.env.NODE_ENV = 'test';
  const path = require('path');
  const distMain = path.resolve(__dirname, '..', 'dist/main/main');

  // The logger service is initialised on-demand in production via
  // initializeLogger(). For this test we want console-only, so we route
  // getLogger() through a stub before the mapper imports it.
  const loggerServicePath = path.join(distMain, 'services', 'logger-service.js');
  const originalLogger = require(loggerServicePath);
  const stub = {
    info: (...a) => console.log('INFO', ...a),
    warn: (...a) => console.log('WARN', ...a),
    error: (...a) => console.log('ERR ', ...a),
    debug: () => {},
    success: (...a) => console.log('OK  ', ...a),
    diag: (...a) => console.log('DIAG', ...a),
    isDiagEnabled: () => true,
  };
  originalLogger.getLogger = () => stub;

  const { HTMLMapper } = require(path.join(distMain, 'services', 'html-mapper.js'));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html);

  const mapper = new HTMLMapper(page);
  const result = await mapper.parseCurrentPage();

  console.log('\n=== RESULT ===');
  console.log('rowsDetected  :', result.rowsDetected);
  console.log('transactions  :', result.transactions.length);
  console.log('rejections    :', result.rejections.length);
  console.log(JSON.stringify(result.transactions, null, 2));

  const t = result.transactions[0];
  const expected = {
    userName: 'fixture_user_001',
    bank: 'bca',
    accountName: 'FICTIONAL HOLDER 001',
    accountNumber: '900000000001',
    amount: 100763,
    status: 'Approved',
    done: 'Yes',
    depositType: 'PGA',
    agent: 'N/A',
    processDate: '2026-07-24 02:45:43',
  };
  let failed = 0;
  for (const [k, v] of Object.entries(expected)) {
    const got = t ? t[k] : '(no transaction)';
    const ok = got === v;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${k}: got=${JSON.stringify(got)} expected=${JSON.stringify(v)}`);
    if (!ok) failed++;
  }

  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
