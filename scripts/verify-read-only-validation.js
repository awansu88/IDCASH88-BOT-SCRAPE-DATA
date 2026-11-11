const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),http=require('http'),Module=require('module');
const {chromium}=require('playwright');
const {spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist/main/main');
const {ReadOnlyRequestPolicy,runReadOnlyValidation}=require(path.join(dist,'validation/read-only-validation'));
const {PlaywrightService}=require(path.join(dist,'services/playwright-service'));
const {main}=require(path.join(dist,'validation/read-only-cli'));
const logs=[];require(path.join(dist,'services/logger-service')).getLogger=()=>Object.fromEntries(['info','warn','error','debug','diag','success'].map(k=>[k,m=>logs.push(String(m))]));
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/deposit-dom/layout-18h-16b.html'),'utf8');
const form='<form method="get" action="/deposit/transactions"><select id="deposit-status" name="status"><option value="Approve">Approve</option></select><input id="deposit-agent-name" name="agent"><select id="payment" name="payment"><option value="">All</option></select><input name="deposit_process_date_from" value="2026-11-11"><input name="deposit_process_date_to" value="2026-11-11"><input type="submit" value=" Filter"></form>';
const profile={id:'fixture',name:'Fixture validation',enabled:true,priority:1};
(async()=>{
 assert.throws(()=>new ReadOnlyRequestPolicy('https://panel.invalid/deposit/transactions?_token=PRIVATE_TOKEN'));
 const policy=new ReadOnlyRequestPolicy('https://panel.invalid/deposit/transactions');
 for(const [url,method,body]of [
  ['https://panel.invalid/?action=approve','GET'],['https://sheets.googleapis.com/','POST',{}],['https://panel.invalid/deposit/approve','GET'],
  ['https://panel.invalid/deposit/transactions','DELETE'],['https://panel.invalid/deposit/transactions','POST',{action:'approve'}],
  ['https://panel.invalid/deposit/transactions?account=PRIVATE_ACCOUNT','GET']])assert.strictEqual(policy.allows(url,method,body),false);
 assert.strictEqual(policy.allows(policy.target.href,'POST',{status:'Approve',_csrf:'synthetic'}),true);
 let requests=0;
 const wrapped=policy.wrap({get:async(url,opts)=>{requests++;assert.strictEqual(opts.maxRedirects,0);return{};},post:async()=>{requests++;return{};}});
 await assert.rejects(()=>wrapped.post('https://panel.invalid/deposit/approve',{form:{},headers:{}}));assert.strictEqual(requests,0);
 await wrapped.get(policy.target.href);assert.strictEqual(requests,1);
 // Actual browser, filter form and both actual source adapters. No production modules/state.
 let scenario='valid',stateChanging=0;
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');
  if(req.method!=='GET'){stateChanging++;res.writeHead(500);res.end();return;}
  const page=Number(url.searchParams.get('page')||1);
  const table=scenario==='schema'&&page===2?fixture.replace('data-label="Process Date"','data-label="Account Number"'):
   scenario==='missing'?'<div>No table</div>':scenario==='partial'?'<table class="table table-striped b-t"><tbody><tr><td>loading</td></tr></tbody></table>':
   scenario==='session'?'<form id="login-form"><input type="password"></form>':scenario==='empty'?fixture.replace(/<tbody>[\s\S]*?<\/tbody>/,'<tbody></tbody>'):fixture;
  res.setHeader('Content-Type','text/html');res.end(form+table+`<ul class="pagination"><li class="active">${page}</li>${page===1?'<li><a rel="next" href="?page=2">Next</a></li>':''}</ul>`);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),headless:true});
 assert(!Object.keys(require.cache).some(file=>/(sqlite-service|google-sheets-service|monitoring-engine|central-ingest-service|fingerprint-generator)\.js$/.test(file)),'no write-capable module imported');
 const originalLoad=Module._load;
 Module._load=function(name,...args){if(/(sqlite-service|google-sheets-service|monitoring-engine|central-ingest-service|fingerprint-generator)/.test(name))throw Error('write-capable dependency loaded');return originalLoad.call(this,name,...args);};
 try{
 const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();
 const address=`http://127.0.0.1:${server.address().port}/deposit/transactions`;
 const isolatedPolicy=new ReadOnlyRequestPolicy(address);await isolatedPolicy.install(context);
 const service=new PlaywrightService({});service.page=page;service.context=context;
 for(const mode of ['LEGACY','FAST','AUTO'])for(const current of ['valid','schema','missing','partial','session','empty']){
  scenario=current;await page.goto(address);
  const result=await runReadOnlyValidation(service,isolatedPolicy,{profile,maxPages:2,mode,shouldStop:()=>false});
  assert.strictEqual(result.databaseOpened,false);assert.strictEqual(result.sheetsWrites,0);assert.strictEqual(result.exportStatus,'NOT_ATTEMPTED');
  assert.strictEqual(result.resumeMarkerAdvanced,false);
  assert.strictEqual(result.rowsParsed,current==='valid'?40:current==='schema'?20:0);
  assert.strictEqual(result.amountTotal,current==='valid'?3257516:current==='schema'?1628758:0);
  if(['schema','missing','partial','session'].includes(current))assert.strictEqual(result.failed,true);
  if(current==='schema')assert.strictEqual(result.trustedPages.length,1);
  if(current==='session')assert.strictEqual(result.terminationReason,'SESSION_EXPIRED');
  if(mode==='AUTO')assert.strictEqual(result.effectiveMode,'FAST');
 }
 scenario='valid';await page.goto(address);
 const stopped=await runReadOnlyValidation(service,isolatedPolicy,{profile,maxPages:3,mode:'LEGACY',shouldStop:()=>true});
 assert.strictEqual(stopped.terminationReason,'STOP_REQUESTED');assert.strictEqual(stopped.rowsParsed,0);
 await assert.rejects(()=>runReadOnlyValidation(service,isolatedPolicy,{profile,maxPages:4,mode:'FAST',shouldStop:()=>false}));
 assert.strictEqual(stateChanging,0);
 await assert.rejects(()=>page.evaluate(()=>fetch('/deposit/approve',{method:'POST'})));
 assert.strictEqual(stateChanging,0,'blocked write never reached server');
 // Run the actual CLI against the same local synthetic server, including prompt,
 // fresh report creation, logger shutdown and temporary profile cleanup.
 scenario='valid';
 const cliDir=fs.mkdtempSync(path.join(os.tmpdir(),'cli-evidence-'));
 try {
  const profileFile=path.join(cliDir,'profile.json'),reportFile=path.join(cliDir,'summary.json');
  fs.writeFileSync(profileFile,'\uFEFF'+JSON.stringify({name:profile.name}));const original=fs.readFileSync(profileFile);
  const before=new Set(fs.readdirSync(os.tmpdir()).filter(name=>name.startsWith('idcash-read-only-')));
  const code=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['-r',path.join(__dirname,'support/test-browser.js'),path.join(__dirname,'validate-read-only.js'),
    '--read-only','--deposit-url',address,'--profile-file',profileFile,'--max-pages','1','--report',reportFile],
    {cwd:root,env:{...process.env,CHROMIUM_PATH:process.env.CHROMIUM_PATH||chromium.executablePath()}});
   let output='',sent=false;const timer=setTimeout(()=>{child.kill();reject(Error('CLI timeout'));},30000);
   child.stdout.on('data',chunk=>{output+=chunk;if(!sent&&output.includes('then press Enter')){sent=true;child.stdin.write('\n');}});
   child.stderr.on('data',()=>{});child.on('error',reject);child.on('exit',status=>{clearTimeout(timer);resolve(status);});
  });
  assert.strictEqual(code,0);const report=JSON.parse(fs.readFileSync(reportFile));
  assert.strictEqual(report.rowsParsed,20);assert.strictEqual(report.amountTotal,1628758);assert.strictEqual(report.sheetsWrites,0);
  assert.deepStrictEqual(fs.readFileSync(profileFile),original);
  assert(fs.readdirSync(os.tmpdir()).filter(name=>name.startsWith('idcash-read-only-')).every(name=>before.has(name)),'CLI removed its temporary session');
 } finally {fs.rmSync(cliDir,{recursive:true,force:true});}
 await context.close();
 }finally{Module._load=originalLoad;await browser.close();await new Promise(resolve=>server.close(resolve));}
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'validation-cli-test-'));
 try{const file=path.join(temp,'profile.json');fs.writeFileSync(file,JSON.stringify(profile));const before=fs.readFileSync(file);
 await assert.rejects(()=>main(['--deposit-url','https://panel.invalid/deposit/transactions','--profile-file',file]));
 await assert.rejects(()=>main(['--read-only','--deposit-url','https://panel.invalid/deposit/transactions','--profile-file',file,'--max-pages','4']));
 assert.deepStrictEqual(fs.readFileSync(file),before);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
 assert(!logs.join('\n').includes('PRIVATE_TOKEN'));
 console.log('PASS: no-write policy, guarded HTTP redirects and writes, 18 real Browser/FAST/AUTO integration cases, bounded/stop behavior, preserved inputs, no write-capable dependency or financial request.');
})().catch(error=>{console.error(error);process.exitCode=1;});
