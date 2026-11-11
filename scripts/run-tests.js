/** Build/typecheck run first via npm test. Preserve every underlying test exit code. */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
const env = { ...process.env, PATH: path.join(root, 'node_modules/.bin') + path.delimiter + process.env.PATH };
if (!env.CHROMIUM_PATH && process.platform === 'linux' && fs.existsSync('/usr/bin/chromium')) env.CHROMIUM_PATH = '/usr/bin/chromium';
let failed = false;
for (const [name, command] of Object.entries(require('../package.json').scripts)) {
  if (!name.startsWith('test:') || name.endsWith(':all')) continue;
  const test = command.replace(/^npm run build:main && /, '');
  const result = spawnSync(test, { cwd: root, shell: true, env, stdio: 'inherit' });
  const status = result.status ?? 1;
  console.log(`${name}: ${status === 0 ? 'PASS' : 'FAIL'} (exit ${status})`);
  if (status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
