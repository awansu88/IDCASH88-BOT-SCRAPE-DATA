/** Filesystem/runtime contracts only. Synthetic staging is never a release artifact. */
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),Module=require('module');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'release-contract-'));
const originalLoad=Module._load,previousPortable=process.env.PORTABLE_EXECUTABLE_DIR,previousCache=process.env.PLAYWRIGHT_BROWSERS_PATH;
const originalHome=os.homedir;
const fakeApp={getPath:()=>path.join(directory,'installed'),getAppPath:()=>path.join(directory,'application'),isPackaged:true};
Module._load=function(name,...args){if(name==='electron')return{app:fakeApp,dialog:{showMessageBox:async()=>({response:0})},clipboard:{writeText(){}},shell:{openExternal:async()=>{}}};return originalLoad.call(this,name,...args);};
const dist=path.join(root,'dist/main/main');
require(path.join(dist,'services/logger-service')).getLogger=()=>({info(){},warn(){},error(){},debug(){},diag(){},success(){}});
(async()=>{try{
 assert(fs.existsSync(path.join(root,pkg.main)),'compiled Electron entry exists');
 assert(fs.existsSync(path.join(root,'dist/renderer/index.html')));
 assert(fs.existsSync(path.join(root,'dist/main/main/preload.js')));
 assert(pkg.build.asarUnpack.includes('**/*.node'));
 assert(pkg.build.files.includes('!resources/browsers/**/*'),'browser not duplicated inside ASAR');
 assert(pkg.build.extraResources.some(r=>r.from==='resources/browsers'&&r.to==='browsers'));
 if(pkg.build.win.icon)assert(fs.existsSync(path.join(root,pkg.build.win.icon)));
 const {AppDirectoryManager}=require(path.join(dist,'services/app-directory-manager'));
 process.env.PORTABLE_EXECUTABLE_DIR=path.join(directory,'portable');
 const portable=new AppDirectoryManager();assert.strictEqual(portable.getBaseDir(),path.join(directory,'portable/LiveDepositMonitor-Data'));
 fs.writeFileSync(portable.getDatabasePath(),'SYNTHETIC_EXISTING_DATA');
 new AppDirectoryManager();assert.strictEqual(fs.readFileSync(portable.getDatabasePath(),'utf8'),'SYNTHETIC_EXISTING_DATA');
 delete process.env.PORTABLE_EXECUTABLE_DIR;
 const installed=new AppDirectoryManager();assert.strictEqual(installed.getBaseDir(),fakeApp.getPath());
 const {ConfigManager}=require(path.join(dist,'services/config-manager'));const config=new ConfigManager(installed);
 const defaults=await config.loadAppConfig();assert(defaults.monitoring);assert(fs.existsSync(installed.getAppConfigPath()));
 assert.deepStrictEqual(await config.loadFilterProfiles(),[]);assert.strictEqual(await config.loadGoogleSheetsConfig(),null);
 fs.writeFileSync(installed.getAppConfigPath(),'invalid synthetic JSON');
 assert.deepStrictEqual(await config.loadAppConfig(),defaults);
 const resolver=require(path.join(dist,'services/browser-resolver'));
 os.homedir=()=>path.join(directory,'empty-home');process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(directory,'missing-browser');
 assert.strictEqual(resolver.resolveChromium().ok,false);
 const {PlaywrightService}=require(path.join(dist,'services/playwright-service'));
 await assert.rejects(()=>new PlaywrightService(installed).launch(),/Chromium browser is not available/);
 // Synthetic discovery fixture, never executed or mistaken for a real browser bundle.
 const cache=path.join(directory,'cache'),folder=path.join(cache,'chromium-999');
 const relative=process.platform==='win32'?'chrome-win/chrome.exe':process.platform==='darwin'?'chrome-mac/Chromium.app/Contents/MacOS/Chromium':'chrome-linux/chrome';
 const exe=path.join(folder,relative);fs.mkdirSync(path.dirname(exe),{recursive:true});fs.writeFileSync(exe,'synthetic discovery fixture');
 process.env.PLAYWRIGHT_BROWSERS_PATH=cache;
 assert.strictEqual(resolver.resolveChromium().executable,exe);
 // Reproduce the confirmed summary defect: an NSIS installer is NOT a portable artifact.
 const staging=path.join(directory,'summary');fs.mkdirSync(path.join(staging,'scripts'),{recursive:true});
 fs.copyFileSync(path.join(root,'scripts/portable-build-summary.js'),path.join(staging,'scripts/portable-build-summary.js'));
 fs.writeFileSync(path.join(staging,'package.json'),JSON.stringify(pkg));
 const browser=path.join(staging,'dist-build/win-unpacked/resources/browsers/chromium-999/chrome-win');
 fs.mkdirSync(browser,{recursive:true});fs.writeFileSync(path.join(browser,'chrome.exe'),'synthetic staging, NOT executable');
 for(const file of ['chrome.dll','chrome_100_percent.pak','resources.pak','v8_context_snapshot.bin','icudtl.dat'])fs.writeFileSync(path.join(browser,file),'synthetic runtime placeholder');
 fs.writeFileSync(path.join(staging,'dist-build/Setup.exe'),'synthetic installer');
 const summary=spawnSync(process.execPath,[path.join(staging,'scripts/portable-build-summary.js')],{encoding:'utf8'});
 assert.strictEqual(summary.status,1,'unrelated installer cannot satisfy portable artifact verification');
 fs.writeFileSync(path.join(staging,'dist-build',pkg.build.portable.artifactName),'synthetic artifact, NOT executable');
 fs.unlinkSync(path.join(browser,'chrome.dll'));
 const incomplete=spawnSync(process.execPath,[path.join(staging,'scripts/portable-build-summary.js')],{encoding:'utf8'});
 assert.strictEqual(incomplete.status,1,'packaged runtime missing a DLL must fail');
 assert(incomplete.stderr.includes('runtime files missing'));
 // Actual Electron ABI test in a child, isolated in-memory SQLite only.
 const electron=require(path.join(root,'node_modules/electron'));
 const abi=spawnSync(typeof electron==='string'?electron:process.execPath,['-e',"const assert=require('assert');assert.equal(process.versions.electron.split('.')[0],'28');const db=new(require('better-sqlite3'))(':memory:');db.exec('CREATE TABLE probe(id INTEGER)');assert.equal(db.prepare('SELECT COUNT(*) n FROM probe').get().n,0);db.close();"],
  {cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8'});
 assert.strictEqual(abi.status,0,abi.stderr);
 console.log('PASS: release entry/preload/renderer paths, portable/installed isolated data, missing/invalid config, missing Chromium, discovery, packaged-resource rules, installer false-positive rejection, Electron 28 native SQLite ABI.');
 console.log('Synthetic staging/discovery fixtures were NOT Windows executable artifacts. Native Windows GUI/runtime remains NOT TESTED.');
 }finally{Module._load=originalLoad;os.homedir=originalHome;
 if(previousPortable===undefined)delete process.env.PORTABLE_EXECUTABLE_DIR;else process.env.PORTABLE_EXECUTABLE_DIR=previousPortable;
 if(previousCache===undefined)delete process.env.PLAYWRIGHT_BROWSERS_PATH;else process.env.PLAYWRIGHT_BROWSERS_PATH=previousCache;
 fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
