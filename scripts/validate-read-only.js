require('../dist/main/main/validation/read-only-cli').main(process.argv.slice(2)).catch(()=>{
 console.error('Read-only validation could not start (invalid options, profile file, or local prerequisite).');process.exitCode=1;
});
