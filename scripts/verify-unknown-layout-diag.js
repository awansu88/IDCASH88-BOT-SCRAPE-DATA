// Verify structural diagnostics for unknown layouts without transaction values or raw HTML.

const { chromium } = require('playwright');
const path = require('path');

const HEAD = `
  <thead><tr>
    <th>#</th><th>User Name</th><th>Bank</th><th>Account Name</th>
    <th>Account Number</th><th>Payment ID</th><th>Currency</th><th>Amount</th>
    <th>Status</th><th>External ID</th><th>Unrecognised-11</th><th>Deposit Type</th>
    <th>Payment Type</th><th>Agent</th><th>Process Date</th><th>Created At</th>
    <th>Unrecognised-17</th>
  </tr></thead>
`;

// 18 <td>s — no such layout is registered.
const UNKNOWN_ROW = `
  <tr>
    <td>1</td><td>user1</td><td>bank1</td><td>name1</td><td>0000-000-0001</td>
    <td>ext1</td><td>IDR</td><td>50,000.00</td><td>Approved</td><td>ext-uuid</td>
    <td>Yes</td><td>PGA</td><td>PT-VAL</td><td>agent1</td><td>2026-07-24 03:00:00</td>
    <td>2026-07-24 02:59:00</td><td>extra-1</td><td>extra-2</td>
  </tr>
`;

const html = `<!doctype html><html><body>
  <table class="table table-striped b-t">
    ${HEAD}
    <tbody>${UNKNOWN_ROW}</tbody>
  </table>
</body></html>`;

(async () => {
  const distMain = path.resolve(__dirname, '..', 'dist/main/main');
  const loggerSvc = require(path.join(distMain, 'services', 'logger-service.js'));
  const captured = [];
  loggerSvc.getLogger = () => ({
    info: (...a) => captured.push(['INFO', ...a]),
    warn: (...a) => captured.push(['WARN', ...a]),
    error: (...a) => captured.push(['ERR', ...a]),
    debug: () => {},
    success: () => {},
    diag: (...a) => captured.push(['DIAG', ...a]),
    isDiagEnabled: () => true,
  });

  const { HTMLMapper } = require(path.join(distMain, 'services', 'html-mapper.js'));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html);

  const mapper = new HTMLMapper(page);
  const result = await mapper.parseCurrentPage();

  await browser.close();

  const asserts = [];
  const push = (name, ok, detail='') => asserts.push({ name, ok, detail });

  push('one row rejected', result.rejections.length === 1);
  push('zero transactions', result.transactions.length === 0);
  const rej = result.rejections[0] || {};
  push('rejection reason mentions unknown layout',
    (rej.reason || '').includes('Unknown production layout') && rej.cellCount === 18);
  push('rejection.headerLabels has 17 entries', (rej.headerLabels || []).length === 17);
  push('rejection excludes cell values', !('cellTexts' in rej));
  push('rejection excludes raw HTML', !('rowOuterHTML' in rej));

  // Verify sanitized counts, code, strategy and approved identities are actionable.
  const diagText = captured.filter(c => c[0] === 'DIAG').map(c => c.slice(1).join(' ')).join('\n');
  push('diag prints header count', diagText.includes('"headerCount":17'));
  push('diag prints normalized identities', diagText.includes('ACCOUNT_NUMBER'));
  push('diag prints body count', diagText.includes('"bodyCounts":[18]'));
  push('diag prints schema failure code', diagText.includes('UNKNOWN_LAYOUT'));
  push('diag excludes raw HTML and transaction values', !/<tr|user1|bank1|name1|0000-000-0001|ext-uuid|extra-1|Unrecognised-11/.test(diagText));
  push('page explicitly untrusted', result.trusted === false);

  let failed = 0;
  for (const a of asserts) {
    console.log(`  ${a.ok ? 'PASS' : 'FAIL'}  ${a.name}${a.detail ? ' — ' + a.detail : ''}`);
    if (!a.ok) failed++;
  }
  console.log(`\nDIAG SAMPLE (first rejection):\n${diagText.split('----------------------------------------').slice(1,3).join('----------------------------------------')}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
