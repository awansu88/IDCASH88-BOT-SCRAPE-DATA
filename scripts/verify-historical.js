const {spawnSync}=require('child_process');
const path=require('path');
let failed=false;
for(const file of ['verify-bug4-html-mapper.js','verify-explicit-layout.js','verify-remaining-issues.js',
  'verify-iter8-acceptance.js','verify-iter9-scanning.js','verify-unknown-layout-diag.js']){
 const result=spawnSync(process.execPath,['-r',path.join(__dirname,'support/test-browser.js'),path.join(__dirname,file)],{stdio:'inherit',env:process.env});
 console.log(`${file}: ${result.status===0?'PASS':'FAIL'} (exit ${result.status})`);if(result.status!==0)failed=true;
}
process.exitCode=failed?1:0;
