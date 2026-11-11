const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const {chromium}=require(root+'/node_modules/playwright');
const html=fs.readFileSync(root+'/scripts/fixtures/deposit-dom/layout-18h-16b.html','utf8');
const old=process.argv[2];
if(!old)throw Error('Usage: node scripts/benchmark-adaptive-deposit-parser.js /absolute/path/to/phase1/dist/main/main');
const current=root+'/dist/main/main';
const logger={diag(){},info(){},warn(){},error(){},debug(){},success(){}};
for(const dir of [old,current])require(dir+'/services/logger-service').getLogger=()=>logger;
const OldBrowser=require(old+'/services/html-mapper').HTMLMapper,NewBrowser=require(current+'/services/html-mapper').HTMLMapper;
const OldFast=require(old+'/sources/raw-http-html-parser').RawHttpHtmlParser,NewFast=require(current+'/sources/raw-http-html-parser').RawHttpHtmlParser;
const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
function instrument(page){let calls=0;
const handle=el=>({$$:async(...args)=>{calls++;return(await el.$$(...args)).map(handle);},getAttribute:async(...args)=>{calls++;return el.getAttribute(...args);},
 textContent:async()=>{calls++;return el.textContent();},evaluate:async(...args)=>{calls++;return el.evaluate(...args);}});
return {page:{$$:async(...args)=>{calls++;return(await page.$$(...args)).map(handle);},$$eval:async(...args)=>{calls++;return page.$$eval(...args);},content:async()=>{calls++;return page.content();}},calls:()=>calls};}
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});const result={fixtureRows:20};
try{const page=await browser.newPage();await page.setContent(html);
for(const [name,Mapper]of [['phase1',OldBrowser],['phase2',NewBrowser]]){const inst=instrument(page),mapper=new Mapper(inst.page);await mapper.parseCurrentPage();const times=[];let lastCalls=inst.calls();let output;
for(let i=0;i<7;i++){const t=performance.now();output=await mapper.parseCurrentPage();times.push(performance.now()-t);}
assert.strictEqual(output.transactions.length,20);result[name]={browserMedianMs:median(times),browserCallsPerParse:(inst.calls()-lastCalls)/7};}
}catch(e){throw e;}finally{await browser.close();}
for(const [name,Parser]of [['phase1',OldFast],['phase2',NewFast]]){const parser=new Parser();for(let i=0;i<10;i++)parser.parse(html);const times=[];
for(let i=0;i<51;i++){const t=performance.now();assert.strictEqual(parser.parse(html).transactions.length,20);times.push(performance.now()-t);}result[name].fastMedianMs=median(times);}
console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
