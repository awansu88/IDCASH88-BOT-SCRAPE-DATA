/** Logging-only review regressions. All identifiers/URLs are synthetic. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const http=require('http');
const os=require('os');
const util=require('util');
const {chromium}=require('playwright');
const {execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist/main');
const logs=[];
require(path.join(dist,'main/services/logger-service')).getLogger=()=>({
  ...Object.fromEntries(['diag','debug','info','warn','error','success'].map(level=>[level,(...args)=>logs.push(util.inspect(args,{depth:8}))])),
  isDiagEnabled:()=>true,
});
const {PageScanner}=require(path.join(dist,'main/services/page-scanner'));
const {MonitoringEngine}=require(path.join(dist,'main/services/monitoring-engine'));
const {MonitoringCycleSourceError}=require(path.join(dist,'main/services/monitoring-failure-policy'));
const {PlaywrightService}=require(path.join(dist,'main/services/playwright-service'));
const {FastHttpSourceAdapter}=require(path.join(dist,'main/sources/fast-http-source-adapter'));
const {RawHttpHtmlParser}=require(path.join(dist,'main/sources/raw-http-html-parser'));
const {SELECTORS}=require(path.join(dist,'utils/selector-repository'));
const {profileTag,diagnosticError,diagnosticCode}=require(path.join(dist,'utils/safe-diagnostics'));
const secrets=['TOKEN_SENTINEL_492','CSRF_SENTINEL_794','SESSION_SENTINEL_973','USER_SENTINEL_841',
  'ACCOUNT_SENTINEL_328','PROFILE_SENTINEL_624','PROFILE_ID_SENTINEL_241','AGENT_SENTINEL_831','PAYMENT_SENTINEL_439'];
const profile={id:secrets[6],name:secrets[5],agent:secrets[7],depositType:secrets[8],enabled:true,priority:1};
const sensitiveUrl=`https://panel.invalid/deposit/player/transactions/${secrets[3]}/account/${secrets[4]}?_token=${secrets[0]}&csrf_token=${secrets[1]}&session_id=${secrets[2]}`;
function poison(){return Object.assign(new Error(sensitiveUrl),{name:secrets[3],code:secrets[0],cause:{cookie:secrets[2]},profileName:profile.name});}
function check(){const output=logs.join('\n');for(const secret of secrets)assert(!output.includes(secret),'sensitive sentinel reached logs');
  for(const fragment of ['_token=','csrf_token=','session_id=','/deposit/player/transactions/'])assert(!output.includes(fragment),'raw navigation metadata reached logs');}
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/deposit-dom/layout-18h-16b.html'),'utf8');
const bad=fixture.replace('data-label="Process Date"','data-label="Account Number"');
const pages={valid:fixture,schema:bad,missing:'<html><body>No table</body></html>',login:'<form id="login-form"><input type="password"></form>'};
const parsed=new RawHttpHtmlParser().parse(fixture);
const stats={pageNumber:1,rowsDetected:1,rowsParsed:1,rowsRejected:0,duplicate:0,buffered:0,exported:0};
async function browserCases(){
  const requests=[];
  const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');requests.push(url);
    const page=Number(url.searchParams.get('page')||1),scenario=url.searchParams.get('case')||'valid';
    const next=new URL(url);next.searchParams.set('page','2');
    const pager=`<ul class="pagination"><li class="active">${page}</li>${page===1?`<li><a rel="next" href="${next.pathname+next.search}">Next</a></li>`:''}</ul>`;
    res.setHeader('Content-Type','text/html');res.end((page===1?fixture:pages[scenario])+pager);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),headless:true});
  try{const page=await browser.newPage();
    for(const scenario of ['valid','schema','missing','login']){
      const url=new URL(sensitiveUrl);url.protocol='http:';url.host=`127.0.0.1:${server.address().port}`;url.searchParams.set('case',scenario);url.searchParams.set('page','1');
      await page.goto(url.href);const scanner=new PageScanner(page);scanner.setDuplicateCheck(()=>false);
      const result=await scanner.scanPages(profile,3);
      assert.strictEqual(result.terminationReason,scenario==='valid'?'END_OF_PAGINATION':scenario==='login'?'SESSION_EXPIRED':'UNSAFE_RESPONSE');
      assert.strictEqual(result.transactions.length,scenario==='valid'?40:20);check();
      const last=new URL(page.url());assert.strictEqual(last.pathname,url.pathname);assert.strictEqual(last.searchParams.get('_token'),secrets[0]);
      assert.strictEqual(last.searchParams.get('page'),'2','internal navigation URLs remain usable');
    }
    // Exercise the exception-bearing navigation timeout and benign termination branches.
    const scanner=new PageScanner(page);scanner.getActivePageFromDom=async()=>2;
    const evaluate=page.evaluate.bind(page),waitForSelector=page.waitForSelector.bind(page);
    page.evaluate=async()=>({clicked:true});page.waitForFunction=async()=>{};
    page.waitForSelector=async()=>{throw poison();};page.waitForLoadState=async()=>{};page.waitForTimeout=async()=>{};
    await scanner.navigateAndVerify(page.url(),1,2);check();
    page.evaluate=evaluate;page.waitForSelector=waitForSelector;
    const benign=new PageScanner({url:()=>sensitiveUrl});
    benign.getActivePageFromDom=async()=>1;benign.htmlMapper={parseCurrentPage:async()=>({...parsed,rejections:[]})};
    benign.hasNextPage=async()=>true;benign.navigateAndVerify=async()=>{throw Object.assign(poison(),{endOfPagination:true});};
    assert.strictEqual((await benign.scanPages(profile)).terminationReason,'END_OF_PAGINATION');check();
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
  assert(requests.some(url=>url.searchParams.get('page')==='2'));
}
function engineHarness(source){
  const config={features:{},monitoring:{maxPageScan:10,batchSize:1000,pollingInterval:2,sourceMode:'LEGACY'}};
  const engine=new MonitoringEngine({validateSession:async()=>({ok:false,reason:sensitiveUrl})},
    {getEnabledProfiles:()=>[profile]}, {}, {generate:()=> 'f'.repeat(40)}, {}, {isConnected:()=>false},
    {loadAppConfig:async()=>{throw poison();}},source);
  engine.config=config;engine.isRunning=true;
  engine.recoverPendingExports=async()=>({pendingFound:0,appended:0,reconciled:0,remaining:0,skipped:null});
  engine.updateExportStats=async()=>{};
  return engine;
}
async function engineCases(){
  // Process summaries, essential-field rejection and error context without changing the internal profile name.
  for(const reason of ['END_OF_PAGINATION','UNSAFE_RESPONSE','SESSION_EXPIRED']){
    const source={scan:async()=>({transactions:[parsed.transactions[0]],perPage:[stats],navigationFailure:reason!=='END_OF_PAGINATION',
      terminationReason:reason,lastPageScanned:1,configuredMaxPage:10})};
    const engine=engineHarness(source);
    engine.centralIngestService={ingest:async(raw,name)=>{assert.strictEqual(name,profile.name);return{status:'REJECTED',errors:['Missing User Name']};}};
    if(reason==='END_OF_PAGINATION')await engine.processFilter(profile);
    else await assert.rejects(()=>engine.processFilter(profile),e=>e.filterName===profile.name&&e.terminationReason===reason);
    check();
  }
  // Actual cycle worker diagnostics: unavailable, fatal, soft error, and config-read exception.
  for(const kind of ['unavailable','fatal','soft']){
    const error=Object.assign(poison(),{...(kind==='unavailable'?{isProfileUnavailable:true}:kind==='fatal'?{isCycleFatal:true}:{})});
    const engine=engineHarness({scan:async()=>{throw error;}});
    if(kind==='fatal')await assert.rejects(()=>engine.runMonitoringCycle());else await engine.runMonitoringCycle();
    check();
  }
  // Pause/retry logs retain safe reason codes but never serialize attached identifiers, messages, names or causes.
  for(const reason of ['UNSAFE_RESPONSE','SESSION_EXPIRED','HTTP_FAILURE',secrets[0]]){
    const engine=engineHarness({});let cycles=0;
    engine.runMonitoringCycle=async()=>{cycles++;if(cycles>1){engine.isRunning=false;return;}
      throw Object.assign(poison(),{terminationReason:reason,filterName:profile.name,rowsHandedOff:secrets[4],requestedMode:secrets[1],effectiveMode:secrets[2]});};
    engine.sleep=async()=>{};await engine.runMonitoringLoop();check();
  }
  const engine=engineHarness({});engine.resumeMarker=secrets[4];await engine.resolveResumeMarker();check();
  const error=new MonitoringCycleSourceError('UNSAFE_RESPONSE',profile.name,0);
  assert.strictEqual(error.filterName,profile.name);assert(!error.message.includes(profile.name));
  assert.strictEqual(diagnosticCode(secrets[0]),'UNKNOWN');assert(!util.inspect(diagnosticError(poison())).includes(secrets[0]));
  const expectedTag=require('crypto').createHash('sha256').update(profile.name).digest('hex').slice(0,12);
  assert.strictEqual(profileTag(profile.name),expectedTag);
  assert(logs.join('\n').includes(expectedTag));
}
async function filterCases(){
  const service=new PlaywrightService({});const calls=[];
  service.page={inputValue:async()=> '2026-11-11',fill:async(...args)=>calls.push(args),selectOption:async(...args)=>calls.push(args),
    click:async()=>{},waitForLoadState:async()=>{},waitForSelector:async()=>{},waitForTimeout:async()=>{}};
  service.resolveLegacyDepositTypeValue=async()=>({value:secrets[8],source:'VALUE'});
  await service.applyFilter(profile,{manualDateMode:true});check();
  assert(calls.some(args=>args.includes(secrets[7])),'raw agent still reaches browser controls');
  assert(calls.some(args=>args.some(arg=>arg?.value===secrets[8])),'raw payment still reaches browser controls');
  service.resolveLegacyDepositTypeValue=async()=>null;
  await assert.rejects(()=>service.applyFilter(profile,{manualDateMode:true}),e=>e.isProfileUnavailable&&e.profileName===profile.name);check();
  service.resolveLegacyDepositTypeValue=async()=>({value:secrets[8],source:'VALUE'});
  service.page.selectOption=async(selector,value)=>{if(value?.value===secrets[8])throw poison();};
  await assert.rejects(()=>service.applyFilter(profile,{manualDateMode:true}),e=>e.isProfileUnavailable);check();
  service.page.inputValue=async()=>secrets[0];service.page.$eval=async()=>{};
  await assert.rejects(()=>service.fillAndVerifyDate(SELECTORS.FILTER.DATE_FROM,'2026-11-11','Date From'));
  service.page.goto=async()=>{throw poison();};
  await assert.rejects(()=>service.navigateToDepositPage(sensitiveUrl));check();
}
async function configurationCases(){
  const {FilterManager}=require(path.join(dist,'main/services/filter-manager'));
  const manager=new FilterManager({saveFilterProfiles:async profiles=>{
    if(profiles.length)assert.strictEqual(profiles[0].name,profile.name);
  }});
  const saved=await manager.createProfile(profile);assert.strictEqual(saved.name,profile.name);
  await manager.updateProfile(saved.id,{agent:profile.agent});assert.strictEqual(manager.getAllProfiles()[0].agent,profile.agent);
  await manager.deleteProfile(saved.id);await assert.rejects(()=>manager.deleteProfile(secrets[6]));check();
  const {ConfigManager}=require(path.join(dist,'main/services/config-manager'));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'logging-review-'));
  try{const file=path.join(directory,'synthetic-config.json');fs.writeFileSync(file,sensitiveUrl);
    const config=new ConfigManager({getAppConfigPath:()=>file,getFilterProfilesPath:()=>file,getGoogleSheetsConfigPath:()=>file});
    assert.strictEqual((await config.loadAppConfig()).version,'1.0.0');
    assert.deepStrictEqual(await config.loadFilterProfiles(),[]);assert.strictEqual(await config.loadGoogleSheetsConfig(),null);check();
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
async function fastCases(){
  const form={formEntries:[],getAttribute:key=>key==='method'?'GET':key==='action'?'/deposit/transactions':null};
  const element=(tagName,name,value,options)=>({tagName,value,options,closest:()=>form,getAttribute:key=>key==='name'?name:'text'});
  const elements={};elements[SELECTORS.FILTER.DEPOSIT_STATUS]=element('SELECT','status','',[{value:'approved',textContent:'Approve'}]);
  elements[SELECTORS.FILTER.DATE_FROM]=element('INPUT','from','2026-11-11');elements[SELECTORS.FILTER.DATE_TO]=element('INPUT','to','2026-11-11');
  const page={url:()=>sensitiveUrl,evaluate:async(fn,arg)=>{const doc=global.document,fd=global.FormData;
    global.document={querySelector:sel=>elements[sel]||null};global.FormData=class{entries(){return[][Symbol.iterator]();}};
    try{return fn(arg);}finally{global.document=doc;global.FormData=fd;}}};
  for(const scenario of ['valid','schema','missing','login']){
    const adapter=new FastHttpSourceAdapter({getPage:()=>page,getRequestContext:()=>({get:async()=>({status:()=>200,url:()=>sensitiveUrl,text:async()=>pages[scenario]})})});
    const result=await adapter.scan({filter:{...profile,agent:undefined,depositType:undefined},manualDateMode:true,maxPages:1,initialSyncMode:false,shouldStop:()=>false,duplicateCheck:()=>false});
    assert.strictEqual(result.terminationReason,scenario==='valid'?'MAX_SCAN_REACHED':scenario==='login'?'SESSION_EXPIRED':'UNSAFE_RESPONSE');check();
  }
}
// Ignore only checkout newline conversion; every other source byte remains protected.
const normalizeNewlines=source=>source.replace(/\r\n/g,'\n');
function assertProtected(actual,expected,message){
  assert.strictEqual(normalizeNewlines(actual),normalizeNewlines(expected),message);
}
(async()=>{
  const sample='const protectedValue = 1;\n// keep whitespace\n';
  assertProtected(sample.replace(/\n/g,'\r\n'),sample);
  assertProtected(sample,sample.replace(/\n/g,'\r\n'));
  for(const changed of [sample.replace('1','2'),sample.replace(' = ','='),sample+'\n',sample.replace(/\n/g,'\r')])
    assert.throws(()=>assertProtected(changed,sample),assert.AssertionError,'real source edits must fail integrity checks');
  const reviewed='d63b003cc8cafe634ff86e9c4fc46edebf003917';
  const baseline=file=>execFileSync('git',['show',`${reviewed}:${file}`],{cwd:root,encoding:'utf8'});
  for(const file of ['src/main/sources/deposit-column-resolver.ts','src/main/sources/deposit-table-layouts.ts',
    'src/main/services/fingerprint-generator.ts','src/main/services/central-ingest-service.ts','src/main/services/sqlite-service.ts',
    'src/main/services/database-migration.ts','src/main/services/google-sheets-service.ts','src/main/services/pending-export-recovery.ts',
    'src/main/sources/raw-http-html-parser.ts','src/main/sources/fast-http-source-adapter.ts'])
    assertProtected(fs.readFileSync(path.join(root,file),'utf8'),baseline(file),'protected implementation changed: '+file);
  const parserFile='src/main/sources/deposit-page-parser.ts';
  const pureBody=source=>source.slice(source.indexOf('function amount('),source.indexOf('/** Allowlisted structural diagnostics'));
  assertProtected(pureBody(fs.readFileSync(path.join(root,parserFile),'utf8')),pureBody(baseline(parserFile)));
  const policyFile='src/main/services/monitoring-failure-policy.ts';
  assertProtected(fs.readFileSync(path.join(root,policyFile),'utf8').split('const PAUSE_REASONS')[1],baseline(policyFile).split('const PAUSE_REASONS')[1]);
  await browserCases();await engineCases();await filterCases();await configurationCases();await fastCases();check();
  for(const structural of ['TABLE DIAGNOSTIC','PAGINATION DIAGNOSTIC','URL Available','UNSAFE_RESPONSE','SESSION_EXPIRED','action=RETRY reason=HTTP_FAILURE'])
    assert(logs.join('\n').includes(structural),'safe debugging metadata missing: '+structural);
  console.log('PASS: sensitive logging: real Chromium pagination, schema/missing/session failures, timeout and benign exceptions, Browser/FAST, filter application, engine summaries/worker/pause/retry, and unchanged internal identifiers.');
})().catch(error=>{console.error(error);process.exitCode=1;});
