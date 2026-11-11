/** Phase 1 DOM regression: supplied sanitized sample, shim and real Chromium. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { load } = require('cheerio');
const { chromium } = require('playwright');
const { createCheerioPage } = require('./support/phase5-cheerio-playwright-shim');
const dist = path.resolve(__dirname, '../dist/main/main');
const diagnostics = [];
require(path.join(dist, 'services/logger-service')).getLogger = () => ({
  info(){}, warn(){}, error(){}, debug(){}, diag(message){ diagnostics.push(message); }
});
const { HTMLMapper } = require(path.join(dist, 'services/html-mapper'));
const { RawHttpHtmlParser, RawHttpResponseClassification: C } = require(path.join(dist, 'sources/raw-http-html-parser'));
const { findDepositTableLayout } = require(path.join(dist, 'sources/deposit-table-layouts'));
const parser = new RawHttpHtmlParser();
const html = fs.readFileSync(path.join(__dirname, 'fixtures/deposit-dom/layout-18h-16b.html'), 'utf8');
const text = value => value.trim().replace(/\s+/g, ' ');
const $ = load(html);
const rows = $('tbody > tr').toArray();
const real = rows.filter(row => $(row).children('td').length === 16);
const placeholder = rows.filter(row => !text($(row).text()));
assert.strictEqual($('thead th').length, 18);
assert.strictEqual(real.length, 20);
assert.strictEqual(placeholder.length, 1);
assert.strictEqual($(placeholder[0]).children('td').length, 19);
assert.deepStrictEqual(findDepositTableLayout(18,16).map, {
  SEQUENCE:0, USER_NAME:1, BANK:2, ACCOUNT_NAME:3, ACCOUNT_NUMBER:4,
  PAYMENT_ID:6, CURRENCY:7, AMOUNT:8, STATUS:9, EXTERNAL_ID:10, DONE:11,
  DEPOSIT_TYPE:12, PAYMENT_TYPE:-1, AGENT:13, PROCESS_DATE:14, CREATED_AT:15
});
// Independent semantic-label expectations for every supported output field.
const expected = real.map(row => {
  const cells = $(row).children('td');
  const label = name => text(cells.filter((_, cell) => $(cell).attr('data-label') === name).text());
  return { userName: text(cells.find('a.player-link').text()), bank: label('Bank'),
    accountName: label('Account Name'), accountNumber: cells.find('[data-bank-number]').attr('data-bank-number'),
    amount: Number(cells.filter('.cell-amount').text().replace(/,/g,'')),
    status: label('Status'), done: label('Done?'), depositType: label('Deposit Type'),
    agent: label('Agent'), processDate: label('Process Date'), createdAt: label('Created At') };
});
assert.strictEqual(expected.reduce((sum, row) => sum + row.amount, 0), 1628758);
async function both(source, page) {
  if (page) await page.setContent(source);
  const browser = await new HTMLMapper(page || createCheerioPage(source)).parseCurrentPage();
  const fast = parser.parse(source);
  assert.deepStrictEqual(browser.transactions, fast.transactions);
  assert.strictEqual(browser.rejections.length, fast.rejections.length);
  return { browser, fast };
}
function acceptance(result) {
  for (const parsed of [result.browser, result.fast]) {
    assert.strictEqual(parsed.rowsDetected, 21);
    assert.strictEqual(parsed.rejections.length, 0);
    assert.deepStrictEqual(parsed.transactions, expected);
    assert.strictEqual(parsed.transactions.reduce((s,t)=>s+t.amount,0),1628758);
    assert(!('paymentId' in parsed.transactions[0]));
  }
  assert.strictEqual(result.fast.classification, C.DEPOSIT_TABLE);
}
function accountVariant(markup) {
  const dom = load(html);
  dom(realSelector()).first().html(markup);
  return dom.html();
}
function realSelector() { return 'tbody tr td[data-label="Account Number"]'; }
(async () => {
  acceptance(await both(html));
  assert(!diagnostics.some(message => /Rejected Row|Empty placeholder/.test(message)));
  for (const file of ['layout-17h-15b.html','layout-16h-16b.html','layout-16h-15b.html']) {
    const source = fs.readFileSync(path.join(__dirname,'fixtures/phase4',file),'utf8');
    const result = await both(source);
    assert.strictEqual(result.fast.classification,C.DEPOSIT_TABLE);
    assert.strictEqual(result.browser.transactions.length,1);
  }
  const unknown = await both(fs.readFileSync(path.join(__dirname,'fixtures/phase4/unknown-layout.html'),'utf8'));
  assert.strictEqual(unknown.fast.classification,C.UNKNOWN_LAYOUT);
  assert.strictEqual(unknown.browser.transactions.length,0);
  assert.strictEqual(unknown.browser.rejections.length,1);
  // Verify the actual DOM adapter, including nested markup and attributes.
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless:true});
  try {
    const page = await browser.newPage();
    acceptance(await both(html,page));
    const highlighted = load(html);
    highlighted('.cell-amount').each((_,cell)=>highlighted(cell).html(`<strong><mark>${highlighted(cell).text()}</mark></strong>`));
    acceptance(await both(highlighted.html(),page));
    for (const [markup, expectedAccount] of [
      ['<span data-bank-number="900000000001"><b>masked display</b></span>', '900000000001'],
      ['<span data-bank-number="900000000001"></span><i data-bank-number=" 900000000001 "></i>', '900000000001'],
      ['<span><b>900000000001</b></span>', '900000000001'],
      ['<span data-bank-number="900000000001"></span><i data-bank-number="OTHER"></i>', null]
    ]) {
      const result = await both(accountVariant(markup),page);
      if (expectedAccount) {
        assert.strictEqual(result.browser.transactions.length,20);
        assert.strictEqual(result.browser.transactions[0].accountNumber,expectedAccount);
      } else {
        assert.strictEqual(result.browser.transactions.length,19);
        assert.strictEqual(result.browser.rejections.length,1);
        assert(result.browser.rejections[0].reason.includes('ACCOUNT_NUMBER'));
        assert.strictEqual(result.fast.classification,C.MALFORMED_DEPOSIT_TABLE);
      }
    }
    // Direct-cell attributes also participate in conflicts; text cannot override them.
    const conflict = load(accountVariant('<span data-bank-number="900000000001">visible</span>'));
    conflict(realSelector()).first().attr('data-bank-number','OTHER');
    assert.strictEqual((await both(conflict.html(),page)).browser.rejections.length,1);
    const empty = load(html);
    empty('tbody tr').filter((_,r)=>text(empty(r).text())!=='').remove();
    const result = await both(empty.html(),page);
    assert.strictEqual(result.browser.rowsDetected,1);
    assert.strictEqual(result.browser.transactions.length,0);
    assert.strictEqual(result.browser.rejections.length,0);
  } finally { await browser.close(); }
  console.log('PASS: Phase 1 fixture: 20 transactions, 0 rejections, 1 silent 19-cell placeholder, total 1628758 IDR; exact Browser/Fast HTTP parity, old layouts, unknown layout, nested markup and canonical conflicts.');
})().catch(error=>{console.error(error);process.exitCode=1;});
