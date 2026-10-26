const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
let failed = false;
function visit(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) visit(file);
    else if (/\.(?:c?js)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status) { console.error(result.stderr); failed = true; }
    }
  }
}
visit(path.join(__dirname, '../app'));
if (failed) process.exit(1);
console.log('JavaScript syntax checks passed.');
