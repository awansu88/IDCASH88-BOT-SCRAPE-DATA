/** Historical browser tests: select an actual installed Chromium, never a fake browser. */
const {chromium}=require('playwright');
const executable=process.env.CHROMIUM_PATH||chromium.executablePath();
const resolver=require('../../dist/main/main/services/browser-resolver');
// These historical tests exercise parsing/filter logic, not discovery. Discovery is
// covered separately by verify-release-readiness with real filesystem probes.
resolver.resolveChromium=()=>({ok:true,source:'env-PLAYWRIGHT_BROWSERS_PATH',browsersPath:require('path').dirname(executable),
 executable,chromiumFolder:null,version:null,searched:[]});
const persistent=chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext=(directory,options)=>persistent(directory,{...options,headless:true});
