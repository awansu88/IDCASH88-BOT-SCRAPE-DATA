const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createCheerioPage } = require('./support/phase5-cheerio-playwright-shim');
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist/main/main');

// Stub before loading either production logger consumer: no Winston/transports/files.
const loggerSvc = require(path.join(dist, 'services/logger-service.js'));
loggerSvc.getLogger = () => ({ info(){}, warn(){}, error(){}, debug(){}, success(){}, diag(){}, isDiagEnabled(){ return false; } });
const { HTMLMapper } = require(path.join(dist, 'services/html-mapper.js'));
const { RawHttpHtmlParser, RawHttpResponseClassification: C, RawHttpParseErrorCode: E } = require(path.join(dist, 'sources/raw-http-html-parser.js'));
const { FingerprintGenerator } = require(path.join(dist, 'services/fingerprint-generator.js'));
const { normalizeAccountNumber } = require(path.join(root, 'dist/main/utils/normalization.js'));
const rawParser = new RawHttpHtmlParser();
const fingerprint = new FingerprintGenerator();
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/phase4', name), 'utf8');
const visibleAccount = html => html.replace(/\sdata-bank-number="[^"]*"/, '');
const bodyRow = html => html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].trim();
const append = (html, rows) => html.replace('</tbody>', `${rows.join('')}</tbody>`);

async function parseBoth(html) {
  return {
    legacy: await new HTMLMapper(createCheerioPage(html)).parseCurrentPage(),
    raw: rawParser.parse(html)
  };
}
const keys = ['userName','bank','accountName','accountNumber','amount','status','done','depositType','agent','processDate','createdAt'].sort();
const diagnostic = (name, row, field, legacy, raw) => `${name}; row index=${row}; field=${field}; legacy=${JSON.stringify(legacy)}; raw=${JSON.stringify(raw)}`;
function compareTransactions(name, legacy, raw, normalizedAccount = false) {
  assert.strictEqual(legacy.length, raw.length, `${name}; transaction cardinality; legacy=${legacy.length}; raw=${raw.length}`);
  legacy.forEach((left, index) => {
    const right = raw[index];
    assert.deepStrictEqual(Object.keys(left).sort(), keys, `${name}; row index=${index + 1}; Legacy keys`);
    assert.deepStrictEqual(Object.keys(right).sort(), keys, `${name}; row index=${index + 1}; Raw keys`);
    for (const field of keys) {
      const lv = field === 'accountNumber' && normalizedAccount ? normalizeAccountNumber(left[field]) : left[field];
      const rv = field === 'accountNumber' && normalizedAccount ? normalizeAccountNumber(right[field]) : right[field];
      assert.deepStrictEqual(lv, rv, diagnostic(name, index + 1, field, left[field], right[field]));
    }
    const lf = fingerprint.generate(left), rf = fingerprint.generate(right);
    assert.strictEqual(lf, rf, diagnostic(name, index + 1, 'fingerprint', lf, rf));
  });
}
function legacyCode(reason) {
  for (const [prefix, code] of [
    ['Missing required field(s):', E.MISSING_REQUIRED_FIELD], ['Invalid Amount Format:', E.INVALID_AMOUNT],
    ['Unknown production layout:', E.UNKNOWN_LAYOUT], ['Footer/summary row skipped', E.FOOTER_ROW]
  ]) if (reason.startsWith(prefix)) return code;
  throw new Error(`Unmapped sanitized Legacy rejection prefix: ${reason.split(':')[0]}`);
}
function compareRejections(name, legacy, raw, expected) {
  assert.deepStrictEqual(legacy.rejections.map(r => legacyCode(r.reason)), expected, `${name}; Legacy rejection semantics`);
  assert.deepStrictEqual(raw.rejections.map(r => r.code), expected, `${name}; Raw rejection semantics`);
}

(async () => {
  // A-C: execute every production layout. B/C deliberately omit canonical account attributes.
  for (const [name, file, normalized] of [
    ['Case A — 17H/15B transaction parity','layout-17h-15b.html',true],
    ['Case B — 16H/16B exact transaction parity','layout-16h-16b.html',false],
    ['Case C — 16H/15B exact transaction parity','layout-16h-15b.html',false]
  ]) {
    const html = normalized ? fixture(file) : visibleAccount(fixture(file));
    const { legacy, raw } = await parseBoth(html);
    assert.strictEqual(raw.classification, C.DEPOSIT_TABLE);
    compareTransactions(name, legacy.transactions, raw.transactions, normalized);
  }

  // D-E: exact RawTransaction contract and visible-text Account Number parity.
  let html = visibleAccount(fixture('layout-17h-15b.html'));
  let result = await parseBoth(html);
  compareTransactions('Cases D-E — exact keys and visible account', result.legacy.transactions, result.raw.transactions);

  // F: canonical account representation now agrees exactly in both parsers.
  result = await parseBoth(fixture('layout-17h-15b.html'));
  assert.strictEqual(result.legacy.transactions[0].accountNumber, result.raw.transactions[0].accountNumber);
  compareTransactions('Case F — canonical account parity', result.legacy.transactions, result.raw.transactions, true);

  // G-H: amount and bounded ordinary-text normalization.
  for (const [input, expected] of [['100,763.00',100763],['IDR 100,763.00',100763],['100763',100763],['100763.49',100763],['100763.50',100764]]) {
    result = await parseBoth(visibleAccount(fixture('layout-17h-15b.html')).replace('IDR 100,763.49', input));
    compareTransactions(`Case G — amount ${input}`, result.legacy.transactions, result.raw.transactions);
    assert.strictEqual(result.raw.transactions[0].amount, expected);
  }
  result = await parseBoth(visibleAccount(fixture('layout-17h-15b.html')).replace('Example User', '\n Example     User \n'));
  compareTransactions('Case H — whitespace', result.legacy.transactions, result.raw.transactions);
  assert.strictEqual(result.raw.transactions[0].userName, 'Example User');

  // I-J: known-layout row rejection parity plus Raw's fail-closed page trust.
  for (const [name, html, code] of [
    ['Case I — missing required', visibleAccount(fixture('layout-17h-15b.html')).replace('797-618-1505',' '), E.MISSING_REQUIRED_FIELD],
    ['Case J — invalid amount', visibleAccount(fixture('layout-17h-15b.html')).replace('IDR 100,763.49','not-a-number'), E.INVALID_AMOUNT]
  ]) {
    result = await parseBoth(html);
    assert.strictEqual(result.legacy.transactions.length, 0); assert.strictEqual(result.raw.transactions.length, 0);
    compareRejections(name, result.legacy, result.raw, [code]);
    assert.strictEqual(result.raw.classification, C.MALFORMED_DEPOSIT_TABLE);
  }

  // K: agree on rejection and H/B facts, never compare rich Legacy row diagnostics.
  result = await parseBoth(fixture('unknown-layout.html'));
  compareRejections('Case K — unknown layout', result.legacy, result.raw, [E.UNKNOWN_LAYOUT]);
  assert.strictEqual(result.raw.classification, C.UNKNOWN_LAYOUT);
  assert.strictEqual(result.legacy.rejections[0].headerLabels.length, result.raw.layout.headerCount);
  assert.strictEqual(result.legacy.rejections[0].cellCount, result.raw.layout.bodyCounts[0]);

  // L-N: placeholders stay silent; footer is a narrow semantic match.
  for (const [name, row, expected] of [
    ['Case L — zero-cell placeholder','<tr></tr>',[]],
    ['Case M — whitespace placeholder',`<tr>${'<td> \n </td>'.repeat(15)}</tr>`,[]],
    ['Case N — footer','<tr><td colspan="17">Sanitized Summary</td></tr>',[E.FOOTER_ROW]]
  ]) {
    result = await parseBoth(append(fixture('empty.html'), [row]));
    assert.strictEqual(result.legacy.rowsDetected, 1); assert.strictEqual(result.raw.rowsDetected, 1);
    assert.strictEqual(result.legacy.transactions.length, 0); assert.strictEqual(result.raw.transactions.length, 0);
    compareRejections(name, result.legacy, result.raw, expected);
    assert.strictEqual(result.raw.classification, C.EMPTY_DEPOSIT_TABLE);
  }

  // O: valid empty table.
  result = await parseBoth(fixture('empty.html'));
  assert.deepStrictEqual(result.legacy.transactions, []);
  assert.deepStrictEqual(result.legacy.rejections, []);
  assert.strictEqual(result.legacy.rowsDetected, 0);
  assert.strictEqual(result.legacy.trusted, true);
  assert.strictEqual(result.raw.transactions.length, 0); assert.strictEqual(result.raw.rejections.length, 0);
  assert.strictEqual(result.raw.classification, C.EMPTY_DEPOSIT_TABLE);

  // P: pairwise source order, with no sorting.
  const base = visibleAccount(fixture('layout-17h-15b.html')), row = bodyRow(base);
  result = await parseBoth(append(base, [row.replace('Example User','Second User').replace('<td>1</td>','<td>2</td>'), row.replace('Example User','Third User').replace('<td>1</td>','<td>3</td>')]));
  compareTransactions('Case P — source order', result.legacy.transactions, result.raw.transactions);
  assert.deepStrictEqual(result.raw.transactions.map(t => t.userName), ['Example User','Second User','Third User']);

  // Q-R: preserve valid diagnostic transaction and reject the malformed row.
  for (const [name, malformed, code] of [
    ['Case Q — mixed missing-required',row.replace('797-618-1505',' '),E.MISSING_REQUIRED_FIELD],
    ['Case R — mixed invalid amount',row.replace('IDR 100,763.49','invalid'),E.INVALID_AMOUNT]
  ]) {
    result = await parseBoth(append(base, [malformed]));
    compareTransactions(name, result.legacy.transactions, result.raw.transactions);
    compareRejections(name, result.legacy, result.raw, [code]);
    assert.strictEqual(result.raw.classification, C.MALFORMED_DEPOSIT_TABLE);
  }

  // S: explicitly freeze intentional Raw semantic-header safety divergence.
  html = base.replace(/<th>[^<]*<\/th>/g, '<th>Unrelated</th>');
  result = await parseBoth(html);
  assert.strictEqual(result.legacy.transactions.length, 0);
  assert.strictEqual(result.raw.transactions.length, 0);
  assert.strictEqual(result.legacy.trusted, false);
  compareTransactions('Case S — transaction semantics before page trust', result.legacy.transactions, result.raw.transactions);
  assert.strictEqual(result.raw.classification, C.UNKNOWN_LAYOUT, 'Case S — both modes reject unverified header structure');

  // T + production-freeze/security/wiring guards.
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const canonicalSource = source => source.replace(/\r\n/g, '\n');
  const canonicalHash = source => crypto.createHash('sha256').update(canonicalSource(source), 'utf8').digest('hex');
  assert.strictEqual(canonicalHash('a\nb\n'), canonicalHash('a\r\nb\r\n'), 'canonical hashes must ignore checkout line endings');
  assert.notStrictEqual(canonicalHash('const x = 1;\n'), canonicalHash('const x = 2;\n'), 'canonical hashes must detect source changes');
  assert(read('src/main/services/html-mapper.ts').includes('parseDepositDocument'));
  assert(read('src/main/sources/raw-http-html-parser.ts').includes('parseDepositDocument'));
  assert(read('src/main/sources/deposit-page-parser.ts').includes('resolveDepositColumns'));
  const frozenHashes = {
    'src/main/sources/deposit-page-parser.ts': 'e6573ef210032b6d5d80e17cc0b5f2162472329dcfd0b294d57e6c07c7d44b45',
    'src/main/sources/deposit-column-resolver.ts': '44c63370864c602a330d83810b3c1ff4bb456e95c8a4a4a47ed8aa4b18383bbe',
    'src/main/sources/deposit-table-layouts.ts': 'f91b96e7de840e47281dc5ab1ca45990cd16fab983ebc184c6382abde1dca67e',
    'src/main/services/html-mapper.ts': 'ef1730c222bbc45d29ffc9d0eb1c84203fc7ecd955724ed281aa4f875d0777a1',
    'src/main/sources/raw-http-html-parser.ts': 'b6ea15f76bdb299827369a0639a86f76265641ebe4349dc79b200c39417a7a68',
    'src/main/services/fingerprint-generator.ts': '624ae907bfa7c9f42d5cd64033587eca39ca49654fc21b4dfc7269309a26f257'
  };
  for (const [file, expected] of Object.entries(frozenHashes)) assert.strictEqual(canonicalHash(read(file)), expected, `${file} changed from verified parser baseline`);
  for (const file of ['src/main/services/monitoring-engine.ts','src/main/sources/legacy-browser-source-adapter.ts']) assert(!read(file).includes('RawHttpHtmlParser'), `${file} must not wire RawHttpHtmlParser`);
  // Phase 6 intentionally adds a dormant FAST adapter. Phase 5's production-impact
  // freeze now guards the original invariant: neither parser nor FAST is default-wired.
  assert(!read('src/main/services/monitoring-engine.ts').includes('FastHttpSourceAdapter'), 'FAST remains dormant');
  const production = Object.keys(frozenHashes).map(read).join('\n');
  for (const forbidden of [/\bfetch\s*\(/,/from ['"]axios['"]/,/\bcontext\.request\b/,/\bbrowserContext\.request\b/,/\/deposit\/transactions/]) assert(!forbidden.test(production), `forbidden HTTP API ${forbidden}`);

  console.log('Phase 5 parser parity passed (Cases A-T).');
  console.log('Intentional results: CANONICAL_ACCOUNT_PARITY; SHARED_FAIL_CLOSED_PAGE_TRUST.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
