/** Phase 2: semantic resolver, page trust, safe diagnostics, both acquisition paths. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { load } = require('cheerio');
const { chromium } = require('playwright');
const { createCheerioPage } = require('./support/phase5-cheerio-playwright-shim');
const dist = path.resolve(__dirname, '../dist/main');
const logs = [];
require(path.join(dist,'main/services/logger-service')).getLogger = () => Object.fromEntries(
  ['info','warn','error','debug','diag','success'].map(key=>[key,(...args)=>logs.push(args.map(String).join(' '))]));
const { HTMLMapper } = require(path.join(dist,'main/services/html-mapper'));
const { RawHttpHtmlParser, RawHttpResponseClassification:C } = require(path.join(dist,'main/sources/raw-http-html-parser'));
const { PageScanner } = require(path.join(dist,'main/services/page-scanner'));
const { LegacyBrowserSourceAdapter } = require(path.join(dist,'main/sources/legacy-browser-source-adapter'));
const { FastHttpSourceAdapter } = require(path.join(dist,'main/sources/fast-http-source-adapter'));
const { SELECTORS } = require(path.join(dist,'utils/selector-repository'));
const { MonitoringEngine } = require(path.join(dist,'main/services/monitoring-engine'));
const { MonitoringFailurePolicy } = require(path.join(dist,'main/services/monitoring-failure-policy'));
const parser = new RawHttpHtmlParser();
const fixture = fs.readFileSync(path.join(__dirname,'fixtures/deposit-dom/layout-18h-16b.html'),'utf8');
const expected = parser.parse(fixture).transactions;
assert.strictEqual(expected.length,20);
const rowSelector = 'tbody > tr';
const realRows = $ => $(rowSelector).filter((_,row)=>$(row).children('td').length === 16);
const mutate = fn => { const $=load(fixture);fn($);return $.html(); };
const extra = mutate($=>{
  $('thead tr').append('<th>Unrelated</th>');
  realRows($).append('<td data-label="Unrelated">unrelated</td>');
});
const unknownIncomplete = load(extra);
unknownIncomplete('[data-label="Process Date"]').removeAttr('data-label');
const cases = [
  ['A 18H/16B',fixture,C.DEPOSIT_TABLE],
  ...['17h-15b','16h-16b','16h-15b'].map(shape=>['B '+shape,fs.readFileSync(path.join(__dirname,`fixtures/phase4/layout-${shape}.html`),'utf8'),C.DEPOSIT_TABLE]),
  ['C extra column',extra,C.DEPOSIT_TABLE],
  ['D reordered semantic columns',mutate($=>{
    const headers=$('thead th').toArray();$(headers[1]).before(headers[8]);
    realRows($).each((_,r)=>{const cells=$(r).children('td').toArray();$(cells[1]).before(cells[8]);});
  }),C.DEPOSIT_TABLE],
  ['E partial labels',mutate($=>$('[data-label="Bank"],[data-label="Account Name"],[data-label="Created At"]').removeAttr('data-label')),C.DEPOSIT_TABLE],
  ['F verified unlabeled fallback',mutate($=>{
    $('[data-label]').removeAttr('data-label');$('.player-link').removeAttr('class');$('.cell-amount').removeAttr('class');
  }),C.DEPOSIT_TABLE],
  ['G unknown complete semantics',extra.replace('<th>Unrelated</th>','<th>Another column</th><th>Another extra</th>'),C.DEPOSIT_TABLE],
  ['H unknown incomplete semantics',unknownIncomplete.html(),C.UNKNOWN_LAYOUT],
  ['I duplicate required labels',mutate($=>realRows($).first().children('td').eq(5).attr('data-label','Amount')),C.UNKNOWN_LAYOUT],
  ['J positional/semantic conflict',mutate($=>{
    const cells=realRows($).first().children('td');cells.eq(14).attr('data-label','Created At');cells.eq(15).attr('data-label','Process Date');
  }),C.UNKNOWN_LAYOUT],
  ['K missing account',mutate($=>realRows($).first().children('td').eq(4).empty()),C.MALFORMED_DEPOSIT_TABLE],
  ['L missing process date',mutate($=>realRows($).first().children('td').eq(14).empty()),C.MALFORMED_DEPOSIT_TABLE],
  ['M malformed amount',mutate($=>realRows($).first().children('td').eq(8).text('not-an-amount')),C.MALFORMED_DEPOSIT_TABLE],
  ...['1e3','12,34.00','100.00 injected'].map(value=>['malformed numeric '+value,mutate($=>realRows($).first().children('td').eq(8).text(value)),C.MALFORMED_DEPOSIT_TABLE]),
  ['N mixed valid/malformed',mutate($=>realRows($).last().children('td').eq(8).text('1.2.3')),C.MALFORMED_DEPOSIT_TABLE],
  ['O placeholder only',mutate($=>realRows($).remove()),C.EMPTY_DEPOSIT_TABLE],
  ['P legitimate empty',mutate($=>$('tbody').empty()),C.EMPTY_DEPOSIT_TABLE],
  ['Q missing table','<html><body>unrelated</body></html>',C.INVALID_HTML],
  ['R login with decoy table',fixture+'<form id="login-form"><input type="password"></form>',C.LOGIN_PAGE],
  ['R permission with decoy table',fixture+'<div class="access-denied">Denied</div>',C.PERMISSION_OR_ERROR_PAGE],
  ['S nested account and amount',mutate($=>{
    realRows($).each((_,row)=>{const cells=$(row).children('td');cells.eq(8).html(`<mark><b>${cells.eq(8).text()}</b></mark>`);
      cells.eq(4).find('span').text('masked display');});
  }),C.DEPOSIT_TABLE],
  ['S canonical conflicts',mutate($=>realRows($).first().children('td').eq(4).append('<i data-bank-number="CONFLICT"></i>')),C.MALFORMED_DEPOSIT_TABLE],
  ['duplicate identical required labels',mutate($=>realRows($).first().append('<td data-label="Amount">50,000.00</td>')),C.UNKNOWN_LAYOUT],
  ['class/label conflict',mutate($=>realRows($).first().children('td').eq(8).attr('data-label','Process Date')),C.UNKNOWN_LAYOUT],
  ['exact normalized aliases',mutate($=>{
    $('[data-label="Done?"]').attr('data-label','  dOnE ?  ');
    $('[data-label="Process Date"]').attr('data-label',' PROCESS   DATE: ');
    $('th').filter((_,cell)=>$(cell).text()==='User Name').text(' Username ');
  }),C.DEPOSIT_TABLE],
  ['invalid calendar date',mutate($=>realRows($).first().children('td').eq(14).text('2026-02-30 01:00:00')),C.MALFORMED_DEPOSIT_TABLE],
  ['small real row is not footer',mutate($=>realRows($).first().children('td').slice(5).remove()),C.UNKNOWN_LAYOUT],
  ['nonempty body th row',mutate($=>{$('tbody').html('<tr><th>Real-looking unexpected content</th></tr>');}),C.UNKNOWN_LAYOUT],
  ['multiple body sections',mutate($=>{
    const rows=realRows($).slice(10);const body=$('<tbody></tbody>');body.append(rows);$('table').append(body);
  }),C.DEPOSIT_TABLE],
  ['colspan critical row is not footer',mutate($=>{
    const row=realRows($).first();row.children('td').slice(5).remove();row.children('td').first().attr('colspan','14');
  }),C.UNKNOWN_LAYOUT],
  ['empty unrecognized headers',mutate($=>{$('tbody').empty();$('th').text('unrecognized');}),C.UNKNOWN_LAYOUT],
];
async function parseBoth(html,page) {
  if(page)await page.setContent(html);
  const browser=await new HTMLMapper(page||createCheerioPage(html)).parseCurrentPage();
  const fast=parser.parse(html);
  assert.deepStrictEqual(browser.transactions,fast.transactions);
  assert.strictEqual(browser.classification,fast.classification);
  assert.strictEqual(browser.trusted,fast.trusted);
  assert.deepStrictEqual(browser.rejections.map(r=>r.code),fast.rejections.map(r=>r.code));
  return {browser,fast};
}
const profile={id:'safe-profile',name:'Fixture profile',enabled:true,priority:1};
// Browser scanner uses real production HTMLMapper with deterministic navigation.
function browserSource(pages, events) {
  let current=0;
  const page={content:async()=>{events.push(`parse-${current+1}`);return pages[current];},
    url:()=>`https://panel.invalid/deposit/transactions?page=${current+1}&token=PRIVATE_TOKEN`};
  const scanner=new PageScanner(page);
  scanner.getActivePageFromDom=async()=>current+1;
  scanner.hasNextPage=async()=>{events.push('next-check');return current+1<pages.length;};
  scanner.navigateAndVerify=async()=>{events.push('next-click');current++;};
  return new LegacyBrowserSourceAdapter({getPage:()=>page,applyFilter:async()=>{}},()=>scanner);
}
// The existing authenticated FAST form/provider contract, without any network.
function fastPage() {
  const form={formEntries:[],getAttribute:key=>key==='method'?'GET':key==='action'?'/deposit/transactions':null};
  const element=(tagName,name,value,options)=>({tagName,value,options,closest:key=>key==='form'?form:null,
    getAttribute:key=>key==='name'?name:key==='type'?'text':null});
  const elements={};
  elements[SELECTORS.FILTER.DEPOSIT_STATUS]=element('SELECT','status','',[{value:'approved',textContent:'Approve'}]);
  elements[SELECTORS.FILTER.DATE_FROM]=element('INPUT','from','2026-11-11');
  elements[SELECTORS.FILTER.DATE_TO]=element('INPUT','to','2026-11-11');
  return {url:()=> 'https://panel.invalid/deposit/transactions',async evaluate(fn,arg){
    const previous=global.document,previousForm=global.FormData;
    global.document={querySelector:selector=>elements[selector]||null};
    global.FormData=class{constructor(f){this.form=f;}entries(){return this.form.formEntries[Symbol.iterator]();}};
    try{return fn(arg);}finally{global.document=previous;global.FormData=previousForm;}
  }};
}
function fastSource(pages,events) {
  let index=0;
  return new FastHttpSourceAdapter({getPage:fastPage,getRequestContext:()=>({async get(url){
    events.push(`get-${++index}`);return{status:()=>200,url:()=>url,text:async()=>pages[index-1]};
  }})});
}
const request={filter:profile,manualDateMode:true,maxPages:10,initialSyncMode:false,
  shouldStop:()=>false,duplicateCheck:()=>false};
const withPager=html=>html+'<ul class="pagination"><li class="active">1</li><li><a href="?page=2">Next</a></li></ul>';
async function boundaries() {
  const broken=cases.find(c=>c[0].startsWith('N '))[1];
  for(const factory of [browserSource,fastSource]) {
    const events=[],batches=[];
    const result=await factory([withPager(fixture),broken],events).scan({...request,
      duplicateCheck:raw=>{events.push('duplicate-check');return false;},onPage:async p=>batches.push(p.pageNumber)});
    assert.strictEqual(result.terminationReason,'UNSAFE_RESPONSE');assert.strictEqual(result.navigationFailure,true);
    assert.deepStrictEqual(batches,[1]);assert.strictEqual(result.transactions.length,20);
    assert.strictEqual(events.filter(e=>e==='duplicate-check').length,20);
    assert.strictEqual(result.perPage.length,1);assert.strictEqual(result.lastPageScanned,1);
    // No callback, duplicate termination, or next navigation on an ambiguous first page.
    const firstEvents=[];
    const first=await factory([broken,fixture],firstEvents).scan({...request,duplicateCheck:()=>{throw Error('untrusted duplicate check');},
      onPage:async()=>{throw Error('untrusted handoff');}});
    assert.strictEqual(first.terminationReason,'UNSAFE_RESPONSE');assert.strictEqual(first.transactions.length,0);
    assert(!firstEvents.includes('next-click'));assert(!firstEvents.includes('get-2'));
    // Placeholder-only page must keep walking rather than triggering duplicate-page stop.
    const empty=cases.find(c=>c[0].startsWith('O '))[1];
    const walked=await factory([withPager(empty),fixture],[]).scan({...request,duplicateCheck:()=>true});
    assert.strictEqual(walked.terminationReason,'FULL_DUPLICATE_PAGE');assert.strictEqual(walked.perPage.length,2);
    for(const [caseName,reason] of [['R login','SESSION_EXPIRED'],['R permission','UNSAFE_RESPONSE'],['Q missing table','UNSAFE_RESPONSE']]) {
      const failure=await factory([cases.find(c=>c[0].startsWith(caseName))[1]],[]).scan(request);
      assert.strictEqual(failure.terminationReason,reason);
      assert.strictEqual(failure.navigationFailure,true);assert.strictEqual(failure.transactions.length,0);
    }
  }
  // Actual MonitoringEngine and central ingest/SQLite claim contract: earlier page
  // remains durable; retry produces no duplicate claim or second Sheets append.
  for(const strategy of ['PER_PAGE','BATCHED'])for(const factory of [browserSource,fastSource]) {
    const claimed=new Map(),exported=new Set(),appends=[];
    const sqlite={isReady:()=>true,claimTransaction:async tx=>{
      if(claimed.has(tx.transactionFingerprint))return false;claimed.set(tx.transactionFingerprint,tx);return true;
    },getPendingExports:async()=>[...claimed.values()].filter(tx=>!exported.has(tx.transactionFingerprint)),
      getPendingExportCount:async()=>[...claimed.keys()].filter(fp=>!exported.has(fp)).length,getResumeMarker:async()=>null};
    const {TransactionValidator}=require(path.join(dist,'main/services/transaction-validator'));
    const {FingerprintGenerator}=require(path.join(dist,'main/services/fingerprint-generator'));
    const engine=new MonitoringEngine({}, {},new TransactionValidator(),new FingerprintGenerator(),sqlite,
      {isConnected:()=>true},{},{scan: req=>factory([withPager(fixture),broken],[]).scan(req)});
    engine.isRunning=true;engine.config={features:{initialSyncMode:true},monitoring:{maxPageScan:10,batchSize:1000,exportStrategy:strategy}};
    engine.recoverPendingExports=async()=>{
      const pending=await sqlite.getPendingExports();appends.push(...pending);
      pending.forEach(tx=>exported.add(tx.transactionFingerprint));
      return{pendingFound:pending.length,appended:pending.length,reconciled:pending.length,alreadyRemote:0,remaining:0,skipped:null,failureClass:null};
    };
    for(let attempt=0;attempt<2;attempt++) {
      await assert.rejects(()=>engine.processFilter(profile),e=>e.isCycleFatal&&e.terminationReason==='UNSAFE_RESPONSE');
      assert.strictEqual(claimed.size,20);assert.strictEqual(engine.cycleCounters.rejected,0);
      if(strategy==='BATCHED')await engine.exportBuffer();
    }
    assert.strictEqual(appends.length,20);assert.deepStrictEqual(appends.map(t=>t.userName),expected.map(t=>t.userName));
    // The existing monitoring loop pauses for schema errors without session reclassification/retry.
    let cycles=0;engine.isRunning=true;engine.runMonitoringCycle=async()=>{cycles++;await engine.processFilter(profile);};
    engine.sleep=async()=>{throw Error('schema retry not allowed');};
    await engine.runMonitoringLoop();assert.strictEqual(engine.getState(),'PAUSED');assert.strictEqual(cycles,1);
    await engine.stopMonitoring();assert.strictEqual(engine.getState(),'IDLE');
  }
  const failedScanner=new PageScanner({url:()=> 'https://panel.invalid/?token=PRIVATE_TOKEN',content:async()=>{throw Error('PRIVATE_TOKEN');}});
  failedScanner.getActivePageFromDom=async()=>1;
  const failedSnapshot=await failedScanner.scanPages(profile);
  assert.strictEqual(failedSnapshot.terminationReason,'BROWSER_FAILURE');
  assert.strictEqual(failedSnapshot.transactions.length,0);
  assert.strictEqual(new MonitoringFailurePolicy().decide({terminationReason:'UNSAFE_RESPONSE'}).reason,'UNSAFE_RESPONSE');
}
(async()=>{
  for(const [name,html,classification]of cases){const r=await parseBoth(html);assert.strictEqual(r.fast.classification,classification,name);
    if(classification===C.DEPOSIT_TABLE&&!name.startsWith('B '))assert.deepStrictEqual(r.fast.transactions,expected,name);
    console.log('PASS:',name);}
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),headless:true});
  try{const page=await browser.newPage();for(const [name,html,classification]of cases){
    const r=await parseBoth(html,page);assert.strictEqual(r.fast.classification,classification,'Chromium '+name);
  }}finally{await browser.close();}
  await boundaries();
  let snapshots=0;
  const snapshotResult=await new HTMLMapper({content:async()=>{snapshots++;return fixture;}}).parseCurrentPage();
  assert.strictEqual(snapshots,1);assert.strictEqual(snapshotResult.trusted,true);
  const acquisitionFailure=await new HTMLMapper({content:async()=>{throw Error('unavailable');}}).parseCurrentPage();
  assert.strictEqual(acquisitionFailure.snapshotFailed,true);assert.strictEqual(acquisitionFailure.trusted,false);
  // Sensitive DOM labels, cells, attributes, errors, and URLs never reach logs.
  const secret='PRIVATE_ACCOUNT_USERNAME_TOKEN';
  const poisoned=mutate($=>{realRows($).first().children('td').eq(8).text(secret);$('th').first().text(secret);
    realRows($).first().children('td').eq(5).attr('data-label',secret);});
  await parseBoth(poisoned);
  const {PlaywrightService}=require(path.join(dist,'main/services/playwright-service'));
  const service=new PlaywrightService({});
  service.page={goto:async()=>{throw Error(secret);}};
  await assert.rejects(()=>service.navigateToDepositPage('https://private.invalid/?token='+secret));
  await new HTMLMapper({content:async()=>{throw Error('https://private.invalid/?token='+secret);}}).parseCurrentPage();
  assert(!logs.join('\n').includes(secret));assert(!logs.join('\n').includes('PRIVATE_TOKEN'));
  for(const value of [expected[0].userName,expected[0].accountName,expected[0].accountNumber])assert(!logs.join('\n').includes(value),'sensitive transaction value reached diagnostics');
  console.log(`PASS: Phase 2 ${cases.length} DOM cases in shim and real Chromium; Browser/FAST page boundaries, engine durability/retry/pause, and redaction.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
