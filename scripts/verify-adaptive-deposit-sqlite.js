/** Phase 2 durable-page regression, executed with Electron's native SQLite ABI. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const os=require('os');
const {load}=require('cheerio');
const dist=path.resolve(__dirname,'../dist/main/main');
require(path.join(dist,'services/logger-service')).getLogger=()=>({info(){},warn(){},error(){},debug(){},diag(){},success(){}});
const {SQLiteService}=require(path.join(dist,'services/sqlite-service'));
const {MonitoringEngine}=require(path.join(dist,'services/monitoring-engine'));
const {TransactionValidator}=require(path.join(dist,'services/transaction-validator'));
const {FingerprintGenerator}=require(path.join(dist,'services/fingerprint-generator'));
const {PageScanner}=require(path.join(dist,'services/page-scanner'));
const {LegacyBrowserSourceAdapter}=require(path.join(dist,'sources/legacy-browser-source-adapter'));
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/deposit-dom/layout-18h-16b.html'),'utf8');
const $=load(fixture);
$('tbody tr').filter((_,row)=>$(row).children('td').length===16).last().children('td').eq(14).empty();
const broken=$.html();
const profile={id:'native',name:'Native fixture',enabled:true,priority:1};
function source() {
  let index=0;
  const page={url:()=>`https://panel.invalid/deposit/transactions?page=${index+1}`,content:async()=>index===0?fixture:broken};
  const scanner=new PageScanner(page);
  scanner.getActivePageFromDom=async()=>index+1;scanner.hasNextPage=async()=>true;
  scanner.navigateAndVerify=async()=>{index++;};
  return new LegacyBrowserSourceAdapter({getPage:()=>page,applyFilter:async()=>{}},()=>scanner);
}
(async()=>{
  assert.strictEqual(String(process.versions.electron||'').split('.')[0],'28');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'adaptive-deposit-sqlite-'));
  try{
    for(const strategy of ['BATCHED','PER_PAGE']) {
      const dbPath=path.join(directory,strategy+'.db');let sqlite=new SQLiteService({getDatabasePath:()=>dbPath});
      await sqlite.initialize();
      const remote=new Map();let writes=0;
      const sheets={isConnected:()=>true,getExportedKeyIdState:async()=>({keyIds:new Set(remote.keys()),latestKeyId:[...remote.keys()].at(-1)||null}),
        appendTransactions:async transactions=>{writes++;for(const tx of transactions){
          const key=tx.transactionFingerprint.substring(0,8).toUpperCase();assert(!remote.has(key),'no second append for accepted transaction');remote.set(key,tx);
        }}};
      const engineFor=()=>{
        const engine=new MonitoringEngine({}, {},new TransactionValidator(),new FingerprintGenerator(),sqlite,sheets,{},
          {scan:request=>source().scan(request)});
        engine.isRunning=true;engine.config={features:{initialSyncMode:true},monitoring:{maxPageScan:10,batchSize:1000,exportStrategy:strategy}};
        return engine;
      };
      let engine=engineFor();
      await assert.rejects(()=>engine.processFilter(profile),e=>e.isCycleFatal&&e.terminationReason==='UNSAFE_RESPONSE'&&e.rowsHandedOff===20);
      assert.strictEqual(await sqlite.getStoredTransactionCount(),20);
      assert.strictEqual(await sqlite.getPendingExportCount(),strategy==='BATCHED'?20:0);
      assert.strictEqual(remote.size,strategy==='BATCHED'?0:20);
      assert.strictEqual(sqlite.getDb().prepare('SELECT SUM(amount) AS total FROM transactions').get().total,1628758);
      assert.strictEqual(sqlite.getDb().prepare('SELECT version FROM schema_version').get().version,1);
      // Restart loses volatile state; recover only trusted durable rows through the actual writer.
      sqlite.close();sqlite=new SQLiteService({getDatabasePath:()=>dbPath});await sqlite.initialize();
      engine=engineFor();await engine.recoverPendingExports();
      assert.strictEqual(remote.size,20);assert.strictEqual(await sqlite.getPendingExportCount(),0);
      const marker=await sqlite.getResumeMarker();assert(marker&&remote.has(marker));
      await assert.rejects(()=>engine.processFilter(profile),e=>e.terminationReason==='UNSAFE_RESPONSE');
      await engine.recoverPendingExports();
      assert.strictEqual(await sqlite.getStoredTransactionCount(),20);assert.strictEqual(remote.size,20);assert.strictEqual(writes,1);
      assert.strictEqual(await sqlite.getResumeMarker(),marker);
      sqlite.close();
      console.log(`PASS: ${strategy} real SQLite: prior page durable, ambiguous page excluded, restart recovery, 20 rows/1628758 IDR, one append, no retry duplicates, schema/marker intact.`);
    }
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
